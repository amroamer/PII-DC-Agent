/**
 * Staged engine runs (Prompt 2 §0, §6). A run writes ONLY to run_items +
 * criterion_assessments. The catalog (assets/attributes/detections/classifications)
 * is untouched until an explicit approval transaction (see approve.ts).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  assets,
  attributes,
  criterionAssessments,
  detections,
  engineRuns,
  runItems,
  type Asset,
  type Attribute,
  type EngineRun,
  type EngineType,
  type Selection,
} from "@shared/models/schema";
import type { CriterionCode } from "@shared/lib/criteria";
import { CRITERION_CODES } from "@shared/lib/criteria";
import type { ClassificationCode } from "@shared/lib/classification";
import { getClassificationRules, getDataClasses, getPrompt, getSetting } from "../reference-cache";
import { classifyByRules } from "../classification-engine/attribute-rules";
import type { CatalogScreen } from "@shared/lib/filter-defs";
import { resolveSelection } from "../catalog/query";
import { getActiveFrameworkVersion } from "../frameworks/store";
import { inferPiiForAttribute, type InferContext, type InferDeps } from "./infer";
import { batchify, sortCanonical } from "../pii-engine/canonicalize";
import type { DetectionInput } from "../pii-engine/types";

export interface CreateRunInput {
  engineType: EngineType;
  screen: CatalogScreen;
  selection: Selection;
  params: Record<string, unknown>;
}

function activeCriteria(params: Record<string, unknown>): CriterionCode[] {
  const requested = params.criteria;
  if (Array.isArray(requested) && requested.length) {
    return CRITERION_CODES.filter((c) => (requested as string[]).includes(c));
  }
  return [...CRITERION_CODES];
}

// In-memory cancellation signal. processRun checks it between batches.
const cancelledRuns = new Set<number>();

export function cancelRun(runId: number): void {
  cancelledRuns.add(runId);
}

/** On boot, any run left 'running' by a previous process can never resume. */
export async function recoverStaleRuns(): Promise<void> {
  await db
    .update(engineRuns)
    .set({ status: "failed", completedAt: new Date() })
    .where(eq(engineRuns.status, "running"));
}

interface PreparedRun {
  run: EngineRun;
  targetIds: number[];
  ctx: ProcessCtx;
}

async function prepareRun(input: CreateRunInput, actorId: number | null): Promise<PreparedRun> {
  const engineVersion = getSetting<string>("engine_version") ?? "0.1.0";
  const threshold =
    (input.params.confidenceThreshold as number) ??
    getSetting<number>("confidence_review_threshold") ??
    0.6;
  const modelId = process.env.OPENAI_MODEL ?? "deterministic-local";
  const promptVersion = `pii_detection_classify@1`;
  const seed = getSetting<number>("inference_seed") ?? 42;
  const framework = await getActiveFrameworkVersion(input.engineType);

  let targetIds = await resolveSelection("attributes", input.selection as any);

  // "Skip items already approved" — exclude attributes that already carry a detection.
  if (input.params.skipApproved !== false && targetIds.length) {
    const existing = await db
      .selectDistinct({ id: detections.attributeId })
      .from(detections)
      .where(inArray(detections.attributeId, targetIds));
    const done = new Set(existing.map((e) => e.id));
    targetIds = targetIds.filter((id) => !done.has(id));
  }

  let previousRunId: number | undefined;
  if (input.params.forceFresh === true) {
    const [prev] = await db
      .select({ id: engineRuns.id })
      .from(engineRuns)
      .where(and(eq(engineRuns.engineType, input.engineType), inArray(engineRuns.status, ["completed", "approved"])))
      .orderBy(desc(engineRuns.id))
      .limit(1);
    previousRunId = prev?.id;
  }

  const [run] = await db
    .insert(engineRuns)
    .values({
      engineType: input.engineType,
      scopeSelection: input.selection as unknown as Record<string, unknown>,
      params: input.params,
      status: "running",
      initiatedBy: actorId ?? undefined,
      previousRunId,
      runNote: typeof input.params.runNote === "string" ? input.params.runNote : undefined,
      modelId,
      promptVersion,
      frameworkVersionId: framework.id ?? undefined,
      engineVersion,
      temperature: 0,
      seed,
      totalItems: targetIds.length,
    })
    .returning();

  const ctx: ProcessCtx = {
    engineType: input.engineType,
    params: input.params,
    threshold,
    modelId,
    promptVersion,
    engineVersion,
    framework,
    seed,
    systemPrompt: getPrompt("pii_detection_classify"),
    criteria: activeCriteria(input.params),
  };
  return { run, targetIds, ctx };
}

async function executeRun(prepared: PreparedRun, deps: InferDeps): Promise<EngineRun> {
  const { run, targetIds, ctx } = prepared;
  try {
    await processRun(run, targetIds, ctx, deps);
    const cancelled = cancelledRuns.delete(run.id);
    const [updated] = await db
      .update(engineRuns)
      .set({ status: cancelled ? "cancelled" : "completed", completedAt: new Date() })
      .where(eq(engineRuns.id, run.id))
      .returning();
    return updated;
  } catch (err) {
    cancelledRuns.delete(run.id);
    await db.update(engineRuns).set({ status: "failed", completedAt: new Date() }).where(eq(engineRuns.id, run.id));
    throw err;
  }
}

/** Synchronous run (awaits completion) — used internally and by tests. */
export async function createEngineRun(
  input: CreateRunInput,
  actorId: number | null,
  deps: InferDeps = {},
): Promise<EngineRun> {
  return executeRun(await prepareRun(input, actorId), deps);
}

/** Async run — creates the row, streams progress in the background, returns immediately. */
export async function startEngineRun(input: CreateRunInput, actorId: number | null): Promise<EngineRun> {
  const prepared = await prepareRun(input, actorId);
  setImmediate(() => {
    executeRun(prepared, {}).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`Engine run ${prepared.run.id} failed:`, err);
    });
  });
  return prepared.run;
}

interface ProcessCtx {
  engineType: EngineType;
  params: Record<string, unknown>;
  threshold: number;
  modelId: string;
  promptVersion: string;
  engineVersion: string;
  framework: { id: number | null; version: string };
  seed: number;
  systemPrompt: string;
  criteria: CriterionCode[];
}

async function processRun(
  run: EngineRun,
  targetIds: number[],
  ctx: ProcessCtx,
  deps: InferDeps,
): Promise<void> {
  if (targetIds.length === 0) return;

  const attrRows = await db.select().from(attributes).where(inArray(attributes.id, targetIds));
  const assetIds = [...new Set(attrRows.map((a) => a.assetId))];
  const assetRows = assetIds.length ? await db.select().from(assets).where(inArray(assets.id, assetIds)) : [];
  const assetMap = new Map<number, Asset>(assetRows.map((a) => [a.id, a]));

  const siblingsByAsset = new Map<number, string[]>();
  const allAttrsByAsset = await db.select().from(attributes).where(inArray(attributes.assetId, assetIds));
  for (const a of allAttrsByAsset) {
    const list = siblingsByAsset.get(a.assetId) ?? [];
    list.push(a.columnName);
    siblingsByAsset.set(a.assetId, list);
  }

  const rules = getClassificationRules();
  const specialCodes = new Set(getDataClasses().filter((d) => d.isSpecialCategory).map((d) => d.code));

  const inferCtx: InferContext = {
    modelId: ctx.modelId,
    promptVersion: ctx.promptVersion,
    frameworkVersion: ctx.framework.version,
    frameworkVersionId: ctx.framework.id,
    engineVersion: ctx.engineVersion,
    activeCriteria: ctx.criteria,
    useCache: ctx.params.useCache !== false,
    forceFresh: ctx.params.forceFresh === true,
    systemPrompt: ctx.systemPrompt,
    threshold: ctx.threshold,
    seed: ctx.seed,
    selfConsistencySamples: typeof ctx.params.selfConsistencySamples === "number" ? ctx.params.selfConsistencySamples : 1,
    confidenceFloor:
      typeof ctx.params.confidenceFloor === "number"
        ? ctx.params.confidenceFloor
        : getSetting<number>("confidence_floor") ?? 0.3,
    includeArabic: ctx.params.includeArabic !== false,
  };

  // Deterministic ordering + reproducible batch boundaries (Prompt 2 §7.2).
  const batchSize = typeof ctx.params.batchSize === "number" ? ctx.params.batchSize : 25;
  const ordered = sortCanonical(attrRows);
  const batches = batchify(ordered, batchSize);

  let processed = 0;
  let cachedCount = 0;
  let errorCount = 0;

  for (const batch of batches) {
   // Cancellation leaves the partial results staged; the catalog stays untouched.
   if (cancelledRuns.has(run.id)) break;
   for (const attr of batch) {
    const asset = assetMap.get(attr.assetId);
    const siblings = (siblingsByAsset.get(attr.assetId) ?? []).filter((n) => n !== attr.columnName);
    const detInput: DetectionInput = {
      attribute: attr,
      asset: {
        id: attr.assetId,
        name: asset?.name ?? "",
        assetType: asset?.assetType ?? null,
        businessDomain: asset?.businessDomain ?? null,
        subjectArea: asset?.subjectArea ?? null,
      },
      siblingColumnNames: siblings,
    };

    try {
      const inference = await inferPiiForAttribute(detInput, inferCtx, deps);
      if (inference.cached) cachedCount++;

      const isSpecial = specialCodes.has(inference.suggestedClassCode ?? "");
      const appliedCriterion =
        inference.assessments.find((a) => a.applies)?.criterionCode ??
        (inference.verdict === "pii" ? "CONTEXTUAL" : null);

      let suggestedLevelCode: ClassificationCode | null = null;
      if (ctx.engineType === "classification") {
        const rule = classifyByRules(
          {
            verdict: inference.verdict,
            criterion: appliedCriterion,
            isSpecialCategory: isSpecial,
            existingLevel: attr.columnDataClassification ?? null,
          },
          rules,
        );
        suggestedLevelCode = rule.level;
      }

      const currentValue =
        ctx.engineType === "pii"
          ? { piiName: attr.piiName, cdeFlag: attr.cdeFlag, columnDataClassification: attr.columnDataClassification }
          : { columnDataClassification: attr.columnDataClassification };

      const autoAccept = inference.confidence >= ctx.threshold && inference.verdict !== "uncertain";

      const [item] = await db
        .insert(runItems)
        .values({
          runId: run.id,
          targetType: "attribute",
          targetId: attr.id,
          verdict: inference.verdict,
          suggestedClassCode: inference.suggestedClassCode,
          suggestedLevelCode,
          confidence: inference.confidence,
          rationaleEn: inference.rationaleEn,
          rationaleAr: inference.rationaleAr,
          sourceLayers: inference.sourceLayers,
          conflict: inference.conflict,
          currentValue,
          stewardDecision: autoAccept ? "accept" : "pending",
          inputHash: inference.inputHash,
          cached: inference.cached,
        })
        .returning();

      // One criterion_assessments row per active criterion (PII only).
      if (ctx.engineType === "pii") {
        await db.insert(criterionAssessments).values(
          inference.assessments.map((a) => ({
            runItemId: item.id,
            criterionCode: a.criterionCode,
            applies: a.applies,
            rationaleEn: a.rationaleEn,
            rationaleAr: a.rationaleAr,
            confidence: a.confidence,
            signals: a.signals,
          })),
        );
      }
      processed++;
      } catch {
        errorCount++;
      }
    }

    // Persist progress once per batch (batch boundaries are reproducible).
    await db
      .update(engineRuns)
      .set({ processedItems: processed, cachedItems: cachedCount, errorItems: errorCount })
      .where(eq(engineRuns.id, run.id));
  }
}

// --- reads ----------------------------------------------------------------
export async function getRun(id: number): Promise<EngineRun | undefined> {
  const [row] = await db.select().from(engineRuns).where(eq(engineRuns.id, id)).limit(1);
  return row;
}

/** Side-by-side comparison of two runs' staged verdicts, keyed by attribute (§7.3). */
export async function compareRuns(runIdA: number, runIdB: number) {
  const [itemsA, itemsB] = await Promise.all([
    db.select().from(runItems).where(eq(runItems.runId, runIdA)),
    db.select().from(runItems).where(eq(runItems.runId, runIdB)),
  ]);
  const byTargetB = new Map(itemsB.map((i) => [i.targetId, i]));
  const attrIds = [...new Set([...itemsA.map((i) => i.targetId), ...itemsB.map((i) => i.targetId)])];
  const attrRows = attrIds.length ? await db.select().from(attributes).where(inArray(attributes.id, attrIds)) : [];
  const attrMap = new Map(attrRows.map((a) => [a.id, a]));

  return itemsA.map((a) => {
    const b = byTargetB.get(a.targetId);
    return {
      targetId: a.targetId,
      columnName: attrMap.get(a.targetId)?.columnName ?? null,
      a: { verdict: a.verdict, confidence: a.confidence, level: a.suggestedLevelCode },
      b: b ? { verdict: b.verdict, confidence: b.confidence, level: b.suggestedLevelCode } : null,
      changed: b ? a.verdict !== b.verdict || a.suggestedLevelCode !== b.suggestedLevelCode : true,
    };
  });
}

export async function getRunItems(runId: number, filter?: { decision?: string }) {
  const items = await db.select().from(runItems).where(eq(runItems.runId, runId));
  const attrIds = items.map((i) => i.targetId);
  const attrRows = attrIds.length ? await db.select().from(attributes).where(inArray(attributes.id, attrIds)) : [];
  const attrMap = new Map(attrRows.map((a) => [a.id, a]));
  const assetIds = [...new Set(attrRows.map((a) => a.assetId))];
  const assetRows = assetIds.length ? await db.select().from(assets).where(inArray(assets.id, assetIds)) : [];
  const assetMap = new Map(assetRows.map((a) => [a.id, a]));

  const assessments = items.length
    ? await db.select().from(criterionAssessments).where(inArray(criterionAssessments.runItemId, items.map((i) => i.id)))
    : [];
  const byItem = new Map<number, typeof assessments>();
  for (const a of assessments) {
    const list = byItem.get(a.runItemId) ?? [];
    list.push(a);
    byItem.set(a.runItemId, list);
  }

  return items
    .filter((i) => !filter?.decision || i.stewardDecision === filter.decision)
    .map((i) => {
      const attr = attrMap.get(i.targetId);
      return {
        ...i,
        columnName: attr?.columnName ?? null,
        assetName: attr ? assetMap.get(attr.assetId)?.name ?? null : null,
        assessments: byItem.get(i.id) ?? [],
      };
    });
}

export async function patchRunItem(
  itemId: number,
  patch: { stewardDecision: string; overrideValue?: Record<string, unknown>; rationale?: string },
) {
  const [updated] = await db
    .update(runItems)
    .set({
      stewardDecision: patch.stewardDecision as any,
      overrideValue: patch.overrideValue,
      overrideRationale: patch.rationale,
    })
    .where(eq(runItems.id, itemId))
    .returning();
  return updated;
}

export async function bulkDecision(runId: number, itemIds: number[], decision: string) {
  if (itemIds.length === 0) return 0;
  const maxBatch = getSetting<number>("max_batch_size") ?? 5000;
  if (itemIds.length > maxBatch) {
    throw Object.assign(
      new Error(`Bulk decision of ${itemIds.length} exceeds the maximum batch size of ${maxBatch}.`),
      { status: 400 },
    );
  }
  await db
    .update(runItems)
    .set({ stewardDecision: decision as any })
    .where(and(eq(runItems.runId, runId), inArray(runItems.id, itemIds)));
  return itemIds.length;
}

/** Resolve a Selection over the staged run_items of a run (not the catalog). */
export async function resolveRunItemIds(runId: number, selection: Selection): Promise<number[]> {
  if (selection.mode === "none") return [];
  if (selection.mode === "include") return selection.ids ?? [];
  const rows = await db
    .select({ id: runItems.id, verdict: runItems.verdict, confidence: runItems.confidence, conflict: runItems.conflict })
    .from(runItems)
    .where(eq(runItems.runId, runId));
  const excluded = new Set(selection.excluded ?? []);
  const f = selection.filters ?? {};
  const verdictFilter = f.verdict as string | undefined;
  const minConfidence = typeof f.minConfidence === "number" ? f.minConfidence : undefined;
  const maxConfidence = typeof f.maxConfidence === "number" ? f.maxConfidence : undefined;
  const conflictOnly = f.conflict === true;
  return rows
    .filter((r) => !excluded.has(r.id))
    .filter((r) => !verdictFilter || r.verdict === verdictFilter)
    .filter((r) => minConfidence === undefined || r.confidence >= minConfidence)
    .filter((r) => maxConfidence === undefined || r.confidence <= maxConfidence)
    .filter((r) => !conflictOnly || r.conflict)
    .map((r) => r.id);
}
