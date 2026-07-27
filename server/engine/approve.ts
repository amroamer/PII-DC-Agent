/**
 * Approval + discard (Prompt 2 §6.3). Approve executes as a SINGLE transaction:
 * a forced failure mid-commit rolls back completely, leaving the catalog
 * byte-identical and no orphaned audit rows. Discard writes nothing.
 *
 * "Commit & see" (publishConfidentRun) is a lighter, non-terminal write: it publishes
 * ONLY the confident auto-accepted items to the catalog so results are visible without
 * a manual approve. It tags its detections with the run id; a later formal approve
 * clears this run's detections first and re-writes the authoritative set (so it stays
 * idempotent and any steward override wins).
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  assets,
  attributes,
  auditLog,
  classifications,
  criterionAssessments,
  detections,
  engineRuns,
  reviewItems,
  runItems,
  type EngineRun,
} from "@shared/models/schema";
import { rollupLevel, type ClassificationCode } from "@shared/lib/classification";
import { primaryCriterion, type CriterionCode } from "@shared/lib/criteria";
import { frameworkVersionLabel } from "../frameworks/store";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type RunItemRow = typeof runItems.$inferSelect;
type AttributeRow = typeof attributes.$inferSelect;

/** Map each run item to its headline applied criterion (precedence order) in one query. */
async function loadPrimaryCriteria(tx: Tx, itemIds: number[]): Promise<Map<number, CriterionCode | null>> {
  const out = new Map<number, CriterionCode | null>();
  if (itemIds.length === 0) return out;
  const applied = await tx
    .select({ runItemId: criterionAssessments.runItemId, criterionCode: criterionAssessments.criterionCode })
    .from(criterionAssessments)
    .where(and(inArray(criterionAssessments.runItemId, itemIds), eq(criterionAssessments.applies, true)));
  const byItem = new Map<number, string[]>();
  for (const a of applied) {
    const list = byItem.get(a.runItemId) ?? [];
    list.push(a.criterionCode);
    byItem.set(a.runItemId, list);
  }
  for (const id of itemIds) out.set(id, primaryCriterion(byItem.get(id) ?? []));
  return out;
}

export interface ApproveResult {
  runId: number;
  attributesChanged: number;
  detectionsWritten: number;
  classificationsWritten: number;
  reviewItemsQueued: number;
  assetsRolledUp: number;
}

/**
 * Write ONE PII detection for an applied run item. Shared by the formal approval and
 * the "commit & see" auto-publish so both produce byte-identical detection provenance.
 * The caller clears this run's prior detections first (approve/publish both delete by
 * runId), so no in-row dedup here.
 *
 * `updateAttribute` gates the authoritative attribute-level write: the formal approval
 * sets `attributes.piiName` + a per-column audit row; auto-publish does NOT (it is a
 * detection-layer preview only — the catalog verdict filter, detection page, KPIs and
 * dashboards all read `detections`, so the preview is fully visible without mutating the
 * governed attribute flag, and a discard just deletes the preview detections).
 */
async function writePiiDetectionForItem(
  tx: Tx,
  args: {
    run: EngineRun;
    item: RunItemRow;
    attr: AttributeRow;
    frameworkVersion: string;
    actorId: number | null;
    justification: string;
    action: string;
    updateAttribute: boolean;
    criterionCode: CriterionCode | null;
  },
): Promise<void> {
  const { run, item, attr } = args;
  const overrideVerdict = (item.overrideValue?.verdict as string | undefined) ?? item.verdict ?? "uncertain";
  const provenance = {
    engineVersion: run.engineVersion ?? "0.1.0",
    runId: String(run.id),
    modelId: run.modelId,
    promptVersion: run.promptVersion,
    frameworkVersion: args.frameworkVersion,
    inputHash: item.inputHash,
    cached: item.cached,
  };
  // Preserve the real originating layer instead of hard-coding "llm".
  const sourceLayers = (item.sourceLayers ?? []) as string[];
  const detLayer =
    item.stewardDecision === "override"
      ? "llm"
      : sourceLayers.includes("llm")
        ? "llm"
        : sourceLayers.includes("adc_class")
          ? "adc_class"
          : "ikc_class";

  await tx.insert(detections).values({
    attributeId: attr.id,
    layer: detLayer as (typeof detections.$inferInsert)["layer"],
    // Headline criterion (or null for not_pii) so KPIs/dashboards can break down by criterion.
    criterionCode: overrideVerdict === "pii" ? args.criterionCode : null,
    verdict: overrideVerdict as any,
    dataClassCode: item.suggestedClassCode,
    confidence: item.confidence,
    rationaleEn: item.rationaleEn,
    rationaleAr: item.rationaleAr,
    evidence: { runItemId: item.id, sourceLayers: item.sourceLayers },
    ...provenance,
  });

  if (!args.updateAttribute) return;

  const before = { piiName: attr.piiName, cdeFlag: attr.cdeFlag };
  await tx
    .update(attributes)
    .set({
      piiName: overrideVerdict === "pii" ? item.suggestedClassCode ?? "PII" : null,
      piiDescription: item.rationaleEn,
    })
    .where(eq(attributes.id, attr.id));

  await tx.insert(auditLog).values({
    actorId: args.actorId ?? undefined,
    action: args.action,
    entityType: "attribute",
    entityId: String(attr.id),
    before,
    after: { verdict: overrideVerdict, piiName: item.suggestedClassCode },
    rationale: args.justification,
    source: "engine",
    runId: run.id,
  });
}

/** Recompute asset-level PII/CDE/classification rollups for the given assets (audited on change). */
async function rollupAssets(
  tx: Tx,
  assetIds: Iterable<number>,
  actorId: number | null,
  justification: string,
  runId: number,
): Promise<number> {
  let n = 0;
  for (const assetId of assetIds) {
    const [existingAsset] = await tx.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    const attrRows = await tx.select().from(attributes).where(eq(attributes.assetId, assetId));
    const levels = attrRows
      .map((a) => a.columnDataClassification)
      .filter((l): l is ClassificationCode => l !== null && l !== undefined);
    const anyPii = attrRows.some((a) => Boolean(a.piiName));
    const anyCde = attrRows.some((a) => a.cdeFlag);
    const rolled = rollupLevel(levels);
    const before = existingAsset
      ? { piiFlag: existingAsset.piiFlag, cdeFlag: existingAsset.cdeFlag, assetClassification: existingAsset.assetClassification }
      : null;
    const after = { piiFlag: anyPii, cdeFlag: anyCde, assetClassification: rolled ?? before?.assetClassification ?? null };

    await tx
      .update(assets)
      .set({ piiFlag: anyPii, cdeFlag: anyCde, ...(rolled ? { assetClassification: rolled } : {}) })
      .where(eq(assets.id, assetId));

    // Only audit when the rollup actually changed something.
    if (!before || before.piiFlag !== after.piiFlag || before.cdeFlag !== after.cdeFlag || before.assetClassification !== after.assetClassification) {
      await tx.insert(auditLog).values({
        actorId: actorId ?? undefined,
        action: "engine_approve_asset_rollup",
        entityType: "asset",
        entityId: String(assetId),
        before,
        after,
        rationale: justification,
        source: "engine",
        runId,
      });
    }
    n++;
  }
  return n;
}

export async function approveRun(
  runId: number,
  justification: string,
  actorId: number | null,
): Promise<ApproveResult> {
  const [run] = await db.select().from(engineRuns).where(eq(engineRuns.id, runId)).limit(1);
  if (!run) throw Object.assign(new Error("Engine run not found."), { status: 404 });
  if (run.status === "approved") throw Object.assign(new Error("Run already approved."), { status: 400 });
  if (run.status !== "completed") throw Object.assign(new Error("Only a completed run can be approved."), { status: 400 });

  // Provenance uses the version the run was PINNED to, not the current active one.
  const framework = { version: await frameworkVersionLabel(run.engineType, run.frameworkVersionId) };
  const result: ApproveResult = {
    runId,
    attributesChanged: 0,
    detectionsWritten: 0,
    classificationsWritten: 0,
    reviewItemsQueued: 0,
    assetsRolledUp: 0,
  };

  await db.transaction(async (tx) => {
    // Clear any detections this run auto-published ("commit & see") so the formal
    // approval re-writes the authoritative set (incl. steward overrides). No-op when
    // the run never auto-published.
    await tx.delete(detections).where(eq(detections.runId, String(run.id)));

    const items = await tx.select().from(runItems).where(eq(runItems.runId, runId));
    const primary = await loadPrimaryCriteria(tx, items.map((i) => i.id));
    const affectedAssetIds = new Set<number>();

    for (const item of items) {
      const [attr] = await tx.select().from(attributes).where(eq(attributes.id, item.targetId)).limit(1);
      if (!attr) continue;
      affectedAssetIds.add(attr.assetId);

      // Rejected + still-pending items make no catalog change (queued for review below).
      const applying = item.stewardDecision === "accept" || item.stewardDecision === "override";

      if (run.engineType === "pii" && applying) {
        await writePiiDetectionForItem(tx, {
          run,
          item,
          attr,
          frameworkVersion: framework.version,
          actorId,
          justification,
          action: "engine_approve_pii",
          updateAttribute: true,
          criterionCode: primary.get(item.id) ?? null,
        });
        result.detectionsWritten++;
        result.attributesChanged++;
      }

      if (run.engineType === "classification" && applying) {
        const level = ((item.overrideValue?.levelCode as ClassificationCode | undefined) ?? item.suggestedLevelCode) as ClassificationCode | null;
        if (level) {
          const [active] = await tx
            .select()
            .from(classifications)
            .where(and(eq(classifications.scope, "attribute"), eq(classifications.targetId, attr.id), isNull(classifications.supersededBy)))
            .limit(1);

          const [inserted] = await tx
            .insert(classifications)
            .values({
              scope: "attribute",
              targetId: attr.id,
              levelCode: level,
              derivedFrom: item.stewardDecision === "override" ? "override" : "engine",
              rationale: item.rationaleEn,
              runId: String(run.id),
              modelId: run.modelId,
              promptVersion: run.promptVersion,
              frameworkVersion: framework.version,
              engineVersion: run.engineVersion,
              inputHash: item.inputHash,
              cached: item.cached,
            })
            .returning();
          if (active) {
            await tx.update(classifications).set({ supersededBy: inserted.id }).where(eq(classifications.id, active.id));
          }
          await tx.update(attributes).set({ columnDataClassification: level }).where(eq(attributes.id, attr.id));
          result.classificationsWritten++;
          result.attributesChanged++;

          await tx.insert(auditLog).values({
            actorId: actorId ?? undefined,
            action: "engine_approve_classification",
            entityType: "attribute",
            entityId: String(attr.id),
            before: { columnDataClassification: attr.columnDataClassification },
            after: { columnDataClassification: level },
            rationale: justification,
            source: "engine",
            runId: run.id,
          });
        }
      }

      // Uncertain / pending -> review queue.
      if (item.stewardDecision === "pending" || item.verdict === "uncertain") {
        await tx.insert(reviewItems).values({
          targetType: "attribute",
          targetId: attr.id,
          status: "pending",
          priority: item.conflict ? 100 : item.verdict === "uncertain" ? 80 : 50,
        });
        result.reviewItemsQueued++;
      }
    }

    // Asset-level rollups for affected assets (audited per changed asset).
    result.assetsRolledUp = await rollupAssets(tx, affectedAssetIds, actorId, justification, run.id);

    await tx
      .update(engineRuns)
      .set({ status: "approved", approvedBy: actorId ?? undefined, approvedAt: new Date() })
      .where(eq(engineRuns.id, runId));
  });

  return result;
}

export interface PublishResult {
  runId: number;
  detectionsWritten: number;
}

/**
 * "Commit & see" — publish the run's confident auto-accepted items to the catalog
 * WITHOUT approving the run. Confident verdicts (pii and not_pii alike) become visible
 * in the catalog / detection page / KPIs immediately; uncertain / conflict / low-confidence
 * items stay staged for review. Re-runnable (clears its own prior publish first) and
 * superseded cleanly by a later formal approve. PII runs only.
 */
export async function publishConfidentRun(runId: number, actorId: number | null): Promise<PublishResult> {
  const [run] = await db.select().from(engineRuns).where(eq(engineRuns.id, runId)).limit(1);
  if (!run) throw Object.assign(new Error("Engine run not found."), { status: 404 });
  if (run.engineType !== "pii") return { runId, detectionsWritten: 0 };

  const framework = { version: await frameworkVersionLabel(run.engineType, run.frameworkVersionId) };
  let detectionsWritten = 0;

  await db.transaction(async (tx) => {
    // Idempotent: clear anything a prior publish of this run wrote, then re-publish.
    // Detections only — no attribute/asset mutation, so a discard just deletes these.
    await tx.delete(detections).where(eq(detections.runId, String(run.id)));

    const items = await tx
      .select()
      .from(runItems)
      .where(and(eq(runItems.runId, runId), eq(runItems.stewardDecision, "accept")));
    const primary = await loadPrimaryCriteria(tx, items.map((i) => i.id));

    for (const item of items) {
      const [attr] = await tx.select().from(attributes).where(eq(attributes.id, item.targetId)).limit(1);
      if (!attr) continue;
      await writePiiDetectionForItem(tx, {
        run,
        item,
        attr,
        frameworkVersion: framework.version,
        actorId,
        justification: "Auto-published confident result (scan mode).",
        action: "engine_autopublish_pii",
        updateAttribute: false,
        criterionCode: primary.get(item.id) ?? null,
      });
      detectionsWritten++;
    }

    // One summary audit row (per-column provenance lives on the detections themselves).
    await tx.insert(auditLog).values({
      actorId: actorId ?? undefined,
      action: "engine_autopublish_pii",
      entityType: "engine_run",
      entityId: String(run.id),
      after: { detectionsWritten },
      rationale: "Auto-published confident results to the catalog (scan mode); not yet formally approved.",
      source: "engine",
      runId: run.id,
    });
  });

  return { runId, detectionsWritten };
}

export async function discardRun(runId: number, actorId: number | null): Promise<EngineRun> {
  const [run] = await db.select().from(engineRuns).where(eq(engineRuns.id, runId)).limit(1);
  if (!run) throw Object.assign(new Error("Engine run not found."), { status: 404 });
  if (run.status === "approved") {
    throw Object.assign(new Error("An approved run cannot be discarded."), { status: 400 });
  }
  // Roll back any "commit & see" detections this run published before discarding.
  await db.delete(detections).where(eq(detections.runId, String(runId)));
  const [updated] = await db
    .update(engineRuns)
    .set({ status: "discarded", completedAt: new Date() })
    .where(eq(engineRuns.id, runId))
    .returning();
  await db.insert(auditLog).values({
    actorId: actorId ?? undefined,
    action: "engine_discard",
    entityType: "engine_run",
    entityId: String(runId),
    rationale: "Run discarded; no catalog changes committed.",
    source: "steward",
    runId,
  });
  return updated;
}
