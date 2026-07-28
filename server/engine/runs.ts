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
import type { CriterionCode, CriterionDef } from "@shared/lib/criteria";
import { CRITERION_CODES, CRITERION_PRECEDENCE } from "@shared/lib/criteria";
import type { ClassificationCode } from "@shared/lib/classification";
import { getDataClasses, getPrompt, getSetting } from "../reference-cache";
import { classifyByRules, reconcileLevel, reconciliationNote, type ClassificationRule } from "../classification-engine/attribute-rules";
import { inferClassificationLevel, type ClassInferContext } from "../classification-engine/classify-infer";
import type { CatalogScreen } from "@shared/lib/filter-defs";
import { joinFacet } from "@shared/lib/facets";
import { resolveSelection } from "../catalog/query";
import {
  getActiveClassificationRules,
  getActiveFrameworkVersion,
  getActivePiiCriteria,
} from "../frameworks/store";
import { inferPiiForAttribute, inferPiiForBatch, PII_SCHEMA_VERSION, type InferContext, type InferDeps, type PiiInferenceOut } from "./infer";
import { publishConfidentRun } from "./approve";
import { AdaptiveRunner } from "./adaptive-runner";
import { RateLimitError } from "../ai-provider";
import { batchify, canonicalizeAttribute, computeInputHash, sortCanonical } from "../pii-engine/canonicalize";
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

/**
 * Appends the active framework's criterion definitions to the base detection
 * prompt so steward edits to a criterion's name/description actually steer the
 * model. The framework version is part of the inference cache key, so an edit
 * (which bumps the version) invalidates stale cached verdicts.
 */
function composeSystemPrompt(
  base: string,
  criteria: CriterionDef[],
  activeCodes: CriterionCode[],
): string {
  const active = criteria.filter((c) => activeCodes.includes(c.code));
  if (active.length === 0) return base;
  const block = active.map((c) => `- ${c.code} (${c.nameEn}): ${c.description}`).join("\n");
  const rules = [
    "Classification rules (apply strictly):",
    "1. Judge THIS column only. A column is personal only if the column itself stores or reveals personal data. Do NOT mark a column personal merely because it sits in an asset/table that also contains identifiers — identifiers in OTHER columns are not evidence about this column.",
    "2. Recognised identifiers and quasi-identifiers are DIRECT or INDIRECT with real confidence — never demote them to Contextual. DIRECT: full name, national ID / Emirates ID, passport number. INDIRECT (confidence >= 0.7): date of birth, phone / mobile / fax, email, vehicle plate / chassis / VIN, precise address, nationality, and other ID-document numbers. SPECIAL_CATEGORY: biometric data — a person's photo / facial image, fingerprint, iris, or scanned signature — and health/medical, religion, or ethnicity. Tag each accordingly.",
    "3. CONTEXTUAL (Contextual Risk) is the LAST resort: use it ONLY for data that becomes personal solely through aggregation or usage and is NOT itself a recognised identifier (e.g. a free-text remarks field that might contain personal data). It does NOT apply to generic operational or system metadata — created/modified/updated timestamps, boolean flags (is_*, *_flag, IsX/HasX camelCase such as IsPolicyAccepted or IsActive, enabled/active/deleted), status/type codes, row versions, sequence or surrogate keys, counts — even inside a table full of personal data. Those are not_pii.",
    "4. The column NAME is the primary evidence; the description is secondary and may be wrong or copied from another table. Set metadataConflict=true when the name and description describe DIFFERENT things (e.g. name 'IMP_NEW_CODE_FLAG' but description 'user who modified'; name 'EXCHANGE_RATE' but description 'vehicle number'). On a conflict, IGNORE the description and classify from the NAME: if the name alone clearly identifies the data (e.g. EMAIL, PASSPORT_NO, MOBILE_NO, a person's name), give a confident verdict from the name; only when the name is ALSO unclear return verdict 'uncertain' with confidence <= 0.4. When name and description agree, or the description is blank, set metadataConflict=false and judge from the name.",
    "5. Confidence must reflect INTRINSIC personal content. If a column would only be 'personal' by association/context (no personal data in the column itself), return not_pii. Reserve confidence >= 0.8 for columns whose own content is clearly personal.",
  ].join("\n");
  return `${base}\n\nCriteria reference (apply these exact definitions):\n${block}\n\n${rules}`;
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
  // The PII inference always hashes against the PII prompt version (so its cache is
  // shared across engine types); the run row records the prompt that DEFINED the run.
  const piiPromptVersion = `pii_detection_classify@5`;
  const classPromptVersion = `classification_classify@2`;
  const runPromptVersion = input.engineType === "classification" ? classPromptVersion : piiPromptVersion;
  const seed = getSetting<number>("inference_seed") ?? 42;
  const framework = await getActiveFrameworkVersion(input.engineType);

  // Composed once here (not just in ctx) so the incremental hash below matches exactly
  // what inferPiiForAttribute will compute — same prompt, same framework, same versions.
  const codes = activeCriteria(input.params);
  const piiCriteria = await getActivePiiCriteria();
  const systemPrompt = composeSystemPrompt(getPrompt("pii_detection_classify"), piiCriteria, codes);

  let targetIds = await resolveSelection("attributes", input.selection as any);

  if (input.engineType === "pii" && input.params.incremental === true && targetIds.length) {
    // Incremental re-scan: keep only columns whose committed detection reflects a DIFFERENT
    // model input (or none). Identical inputHash ⇒ identical result ⇒ nothing to re-learn.
    // Supersedes the coarse skipApproved. Verified against detections (the committed catalog).
    const before = targetIds.length;
    targetIds = await dropUnchangedTargets(targetIds, {
      promptVersion: piiPromptVersion,
      frameworkVersion: framework.version,
      modelId,
      engineVersion,
      systemPrompt,
    });
    // eslint-disable-next-line no-console
    console.log(`Engine run (incremental): ${before} selected → ${targetIds.length} new/changed (${before - targetIds.length} unchanged, skipped).`);
  } else if (input.params.skipApproved !== false && targetIds.length) {
    // "Skip items already approved" — exclude attributes that already carry a detection.
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
      promptVersion: runPromptVersion,
      frameworkVersionId: framework.id ?? undefined,
      engineVersion,
      temperature: 0,
      seed,
      totalItems: targetIds.length,
    })
    .returning();

  const classificationRules =
    input.engineType === "classification" ? await getActiveClassificationRules() : [];

  const ctx: ProcessCtx = {
    engineType: input.engineType,
    params: input.params,
    threshold,
    modelId,
    promptVersion: piiPromptVersion,
    classPromptVersion,
    engineVersion,
    framework,
    seed,
    systemPrompt,
    classSystemPrompt: getPrompt("classification_classify"),
    criteria: codes,
    classificationRules,
  };
  return { run, targetIds, ctx };
}

interface IncrementalHashCtx {
  promptVersion: string;
  frameworkVersion: string;
  modelId: string;
  engineVersion: string;
  systemPrompt: string;
}

/**
 * Incremental filter (B): return only the target ids whose freshly-computed inputHash
 * differs from (or has no) committed detection. Recomputes the SAME canonical payload +
 * hash the inference layer uses, so an unchanged column is provably a no-op to re-scan.
 */
async function dropUnchangedTargets(targetIds: number[], hc: IncrementalHashCtx): Promise<number[]> {
  const attrRows = await db.select().from(attributes).where(inArray(attributes.id, targetIds));
  const assetIds = [...new Set(attrRows.map((a) => a.assetId))];
  const assetRows = assetIds.length ? await db.select().from(assets).where(inArray(assets.id, assetIds)) : [];
  const assetMap = new Map<number, Asset>(assetRows.map((a) => [a.id, a]));

  const siblingsByAsset = new Map<number, string[]>();
  const allAttrs = assetIds.length ? await db.select().from(attributes).where(inArray(attributes.assetId, assetIds)) : [];
  for (const a of allAttrs) {
    const list = siblingsByAsset.get(a.assetId) ?? [];
    list.push(a.columnName);
    siblingsByAsset.set(a.assetId, list);
  }

  // Latest committed detection inputHash per attribute (append-only table → keep newest).
  const dets = await db
    .select({ attributeId: detections.attributeId, inputHash: detections.inputHash, createdAt: detections.createdAt })
    .from(detections)
    .where(inArray(detections.attributeId, targetIds));
  const latestHash = new Map<number, string | null>();
  const latestAt = new Map<number, number>();
  for (const d of dets) {
    const t = d.createdAt ? new Date(d.createdAt).getTime() : 0;
    if (!latestAt.has(d.attributeId) || t >= (latestAt.get(d.attributeId) as number)) {
      latestAt.set(d.attributeId, t);
      latestHash.set(d.attributeId, d.inputHash ?? null);
    }
  }

  const kept: number[] = [];
  for (const attr of attrRows) {
    const asset = assetMap.get(attr.assetId);
    const siblings = (siblingsByAsset.get(attr.assetId) ?? []).filter((n) => n !== attr.columnName);
    const canonical = canonicalizeAttribute(
      attr,
      { name: asset?.name ?? "", businessDomain: joinFacet(asset?.businessDomain), subjectArea: joinFacet(asset?.subjectArea) },
      siblings,
    );
    const hash = computeInputHash({
      payload: canonical,
      promptVersion: hc.promptVersion,
      frameworkVersion: hc.frameworkVersion,
      modelId: hc.modelId,
      engineVersion: hc.engineVersion,
      schemaVersion: PII_SCHEMA_VERSION,
      systemPrompt: hc.systemPrompt,
    });
    if (latestHash.get(attr.id) !== hash) kept.push(attr.id);
  }
  return kept;
}

/** Ceiling for the adaptive concurrency controller (AdaptiveRunner ramps up to this, backing
 *  off on 429s). The engine was fully sequential; the LLM layer dominates wall-clock. */
const RUN_CONCURRENCY = Number(process.env.RUN_CONCURRENCY) || 12;

/** A rate-limit is the only failure the controller reacts to; everything else propagates. */
const rateLimitProbe = (err: unknown): number | null | false =>
  err instanceof RateLimitError ? err.retryAfterMs : false;

/**
 * Review priority for a staged item (D): work the riskiest first. A layer conflict is the
 * most urgent (deterministic and LLM disagree), then an uncertain verdict, then a borderline
 * confidence near the review threshold, then a plain PII call; confident not_pii is lowest.
 */
function runItemPriority(item: { verdict: string | null; confidence: number; conflict: boolean }, threshold: number): number {
  if (item.conflict) return 100;
  if (item.verdict === "uncertain") return 80;
  if (Math.abs(item.confidence - threshold) <= 0.1) return 60;
  if (item.verdict === "pii") return 40;
  return 20;
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

    // "Commit & see" (A): publish confident auto-accepted verdicts to the catalog so
    // they're visible without a manual approve. A publish failure must NOT fail the run —
    // the staged results are intact and the steward can still approve manually.
    if (!cancelled && updated.status === "completed" && ctx.engineType === "pii" && ctx.params.publishConfident === true) {
      try {
        const published = await publishConfidentRun(run.id, run.initiatedBy ?? null);
        // eslint-disable-next-line no-console
        console.log(`Engine run ${run.id}: auto-published ${published.detectionsWritten} confident detections (commit & see).`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`Engine run ${run.id}: auto-publish failed (staged results intact):`, err);
      }
    }
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
  /** Prompt version for the classification LLM layer (classification runs only). */
  classPromptVersion: string;
  engineVersion: string;
  framework: { id: number | null; version: string };
  seed: number;
  systemPrompt: string;
  /** System prompt for the classification LLM layer (classification runs only). */
  classSystemPrompt: string;
  criteria: CriterionCode[];
  classificationRules: ClassificationRule[];
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

  const rules = ctx.classificationRules;
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
    shortCircuitOperational: ctx.params.shortCircuitOperational !== false,
  };

  const classInferCtx: ClassInferContext = {
    modelId: ctx.modelId,
    promptVersion: ctx.classPromptVersion,
    frameworkVersion: ctx.framework.version,
    frameworkVersionId: ctx.framework.id,
    engineVersion: ctx.engineVersion,
    useCache: ctx.params.useCache !== false,
    forceFresh: ctx.params.forceFresh === true,
    systemPrompt: ctx.classSystemPrompt,
    seed: ctx.seed,
    includeArabic: ctx.params.includeArabic !== false,
  };

  // Deterministic ordering + reproducible batch boundaries (Prompt 2 §7.2).
  const batchSize = typeof ctx.params.batchSize === "number" ? ctx.params.batchSize : 25;
  const ordered = sortCanonical(attrRows);
  const batches = batchify(ordered, batchSize);

  // C2 (prototype, PII only): send several columns per LLM call. Eval-gated — off by default.
  const batchMode = ctx.engineType === "pii" && ctx.params.batchInference === true;
  const llmBatchSize = typeof ctx.params.llmBatchSize === "number" ? Math.max(2, ctx.params.llmBatchSize) : 8;

  let processed = 0;
  let cachedCount = 0;
  let errorCount = 0;
  // Adaptive concurrency: ramps up to RUN_CONCURRENCY, halves + cools down on any 429.
  const runner = new AdaptiveRunner({ max: RUN_CONCURRENCY });

  const buildDetInput = (attr: Attribute): DetectionInput => {
    const asset = assetMap.get(attr.assetId);
    const siblings = (siblingsByAsset.get(attr.assetId) ?? []).filter((n) => n !== attr.columnName);
    return {
      attribute: attr,
      asset: {
        id: attr.assetId,
        name: asset?.name ?? "",
        assetType: asset?.assetType ?? null,
        businessDomain: joinFacet(asset?.businessDomain),
        subjectArea: joinFacet(asset?.subjectArea),
      },
      siblingColumnNames: siblings,
    };
  };

  // Persist ONE attribute's inference (PII or classification). `precomputed` supplies the PII
  // inference from a batch call; otherwise it is fetched per-column here.
  const processAttr = async (attr: Attribute, precomputed?: PiiInferenceOut): Promise<void> => {
    const detInput = buildDetInput(attr);
    try {
      const inference = precomputed ?? (await runner.run(() => inferPiiForAttribute(detInput, inferCtx, deps), rateLimitProbe));
      if (inference.cached) cachedCount++;

      const appliedCriterion =
        CRITERION_PRECEDENCE.find((code) => inference.assessments.some((a) => a.applies && a.criterionCode === code)) ??
        null;
      const isSpecial =
        appliedCriterion === "SPECIAL_CATEGORY" || specialCodes.has(inference.suggestedClassCode ?? "");

      // Run-item fields default to the PII inference; the classification branch overrides
      // them with the confidentiality LLM's verdict/rationale/confidence.
      let suggestedLevelCode: ClassificationCode | null = null;
      let itemConfidence = inference.confidence;
      let itemRationaleEn = inference.rationaleEn;
      let itemRationaleAr = inference.rationaleAr;
      let itemSourceLayers = inference.sourceLayers;
      // For classification, auto-accept rides on the classification confidence; null means
      // the LLM layer was skipped (offline) and we keep the PII-verdict-based rule below.
      let classConfidence: number | null = null;

      if (ctx.engineType === "classification") {
        // Governance floor: personal data ≥ Confidential, special category → Sensitive, IKC floor.
        const ruleFloor = classifyByRules(
          {
            verdict: inference.verdict,
            criterion: appliedCriterion,
            isSpecialCategory: isSpecial,
            existingLevel: attr.columnDataClassification ?? null,
          },
          rules,
        ).level;
        // Semantic layer can only RAISE the floor (escalate-only), e.g. → Secret for enforcement.
        const classResult = await runner.run(
          () =>
            inferClassificationLevel(
              detInput,
              { verdict: inference.verdict, criterion: appliedCriterion, isSpecialCategory: isSpecial },
              classInferCtx,
              {},
            ),
          rateLimitProbe,
        );
        suggestedLevelCode = reconcileLevel(classResult.level, ruleFloor);
        if (classResult.cached) cachedCount++;

        if (classResult.level) {
          classConfidence = classResult.confidence;
          itemConfidence = classResult.confidence;
          // When the governance floor raised the level above the model's own call, lead the
          // rationale with WHY — otherwise the stored "Level: Confidential…" text contradicts a
          // Sensitive/Secret badge and confuses the steward.
          const recon = reconciliationNote(
            classResult.level,
            suggestedLevelCode,
            attr.columnDataClassification ?? null,
            classInferCtx.includeArabic,
          );
          itemRationaleEn = recon.en + (classResult.rationaleEn || `Classified ${suggestedLevelCode}.`);
          itemRationaleAr = recon.ar + classResult.rationaleAr;
          itemSourceLayers = [
            "classification_llm",
            ...(suggestedLevelCode !== classResult.level ? ["rule_floor"] : []),
          ];
        } else {
          // AI layer unavailable — deterministic floor stands (offline-safe, old behaviour).
          itemConfidence = inference.confidence;
          itemRationaleEn = `Classified ${suggestedLevelCode} by rule (framework default floor); AI classification layer unavailable.`;
          itemRationaleAr = "";
          itemSourceLayers = ["rule_floor"];
        }
      }

      const currentValue =
        ctx.engineType === "pii"
          ? { piiName: attr.piiName, cdeFlag: attr.cdeFlag, columnDataClassification: attr.columnDataClassification }
          : { columnDataClassification: attr.columnDataClassification };

      const autoAccept =
        ctx.engineType === "classification"
          ? classConfidence !== null
            ? classConfidence >= ctx.threshold
            : inference.confidence >= ctx.threshold && inference.verdict !== "uncertain"
          : inference.confidence >= ctx.threshold && inference.verdict !== "uncertain";

      const [item] = await db
        .insert(runItems)
        .values({
          runId: run.id,
          targetType: "attribute",
          targetId: attr.id,
          verdict: inference.verdict,
          suggestedClassCode: inference.suggestedClassCode,
          suggestedLevelCode,
          confidence: itemConfidence,
          rationaleEn: itemRationaleEn,
          rationaleAr: itemRationaleAr,
          sourceLayers: itemSourceLayers,
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
  };

  for (const batch of batches) {
    // Cancellation leaves the partial results staged; the catalog stays untouched.
    if (cancelledRuns.has(run.id)) break;
    if (batchMode) {
      // Chunk each DB batch into small LLM sub-batches; each is one inferPiiForBatch call.
      const chunks = batchify(batch, llmBatchSize);
      await Promise.all(
        chunks.map(async (chunk) => {
          const inputs = chunk.map(buildDetInput);
          let inferences: PiiInferenceOut[];
          try {
            inferences = await runner.run(() => inferPiiForBatch(inputs, inferCtx, deps), rateLimitProbe);
          } catch {
            errorCount += chunk.length;
            return;
          }
          await Promise.all(chunk.map((attr, idx) => processAttr(attr, inferences[idx])));
        }),
      );
    } else {
      await Promise.all(batch.map((attr) => processAttr(attr)));
    }

    // Persist progress once per batch (batch boundaries are reproducible).
    await db
      .update(engineRuns)
      .set({ processedItems: processed, cachedItems: cachedCount, errorItems: errorCount })
      .where(eq(engineRuns.id, run.id));
  }
  if (runner.backoffs > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `Engine run ${run.id}: adaptive concurrency settled at ${runner.limit}/${RUN_CONCURRENCY} ` +
        `(peak ${runner.peak}, ${runner.backoffs} rate-limit backoffs).`,
    );
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

export async function getRunItems(runId: number, filter?: { decision?: string; sort?: string }) {
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

  const threshold = getSetting<number>("confidence_review_threshold") ?? 0.6;
  const mapped = items
    .filter((i) => !filter?.decision || i.stewardDecision === filter.decision)
    .map((i) => {
      const attr = attrMap.get(i.targetId);
      const asset = attr ? assetMap.get(attr.assetId) : undefined;
      return {
        ...i,
        columnName: attr?.columnName ?? null,
        assetName: asset?.name ?? null,
        assetDescriptionEn: asset?.descriptionEn ?? null,
        assetDescriptionAr: asset?.descriptionAr ?? null,
        columnDescriptionEn: attr?.descriptionEn ?? null,
        columnDescriptionAr: attr?.descriptionAr ?? null,
        assessments: byItem.get(i.id) ?? [],
        priority: runItemPriority(i, threshold),
      };
    });

  // D: default keeps insertion (canonical) order; explicit sorts surface the riskiest first.
  if (filter?.sort === "priority") mapped.sort((a, b) => b.priority - a.priority || a.confidence - b.confidence);
  else if (filter?.sort === "confidence") mapped.sort((a, b) => a.confidence - b.confidence);
  return mapped;
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
