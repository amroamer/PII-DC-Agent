/**
 * Approval + discard (Prompt 2 §6.3). Approve executes as a SINGLE transaction:
 * a forced failure mid-commit rolls back completely, leaving the catalog
 * byte-identical and no orphaned audit rows. Discard writes nothing.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  assets,
  attributes,
  auditLog,
  classifications,
  detections,
  engineRuns,
  reviewItems,
  runItems,
  type EngineRun,
} from "@shared/models/schema";
import { rollupLevel, type ClassificationCode } from "@shared/lib/classification";
import { frameworkVersionLabel } from "../frameworks/store";

export interface ApproveResult {
  runId: number;
  attributesChanged: number;
  detectionsWritten: number;
  classificationsWritten: number;
  reviewItemsQueued: number;
  assetsRolledUp: number;
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
    const items = await tx.select().from(runItems).where(eq(runItems.runId, runId));
    const affectedAssetIds = new Set<number>();

    for (const item of items) {
      const [attr] = await tx.select().from(attributes).where(eq(attributes.id, item.targetId)).limit(1);
      if (!attr) continue;
      affectedAssetIds.add(attr.assetId);

      // Rejected + still-pending items make no catalog change (queued for review below).
      const applying = item.stewardDecision === "accept" || item.stewardDecision === "override";

      if (run.engineType === "pii" && applying) {
        const overrideVerdict = (item.overrideValue?.verdict as string | undefined) ?? item.verdict ?? "uncertain";
        const provenance = {
          engineVersion: run.engineVersion ?? "0.1.0",
          runId: String(run.id),
          modelId: run.modelId,
          promptVersion: run.promptVersion,
          frameworkVersion: framework.version,
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
          criterionCode: null,
          verdict: overrideVerdict as any,
          dataClassCode: item.suggestedClassCode,
          confidence: item.confidence,
          rationaleEn: item.rationaleEn,
          rationaleAr: item.rationaleAr,
          evidence: { runItemId: item.id, sourceLayers: item.sourceLayers },
          ...provenance,
        });
        result.detectionsWritten++;

        const before = { piiName: attr.piiName, cdeFlag: attr.cdeFlag };
        await tx
          .update(attributes)
          .set({
            piiName: overrideVerdict === "pii" ? item.suggestedClassCode ?? "PII" : null,
            piiDescription: item.rationaleEn,
          })
          .where(eq(attributes.id, attr.id));
        result.attributesChanged++;

        await tx.insert(auditLog).values({
          actorId: actorId ?? undefined,
          action: "engine_approve_pii",
          entityType: "attribute",
          entityId: String(attr.id),
          before,
          after: { verdict: overrideVerdict, piiName: item.suggestedClassCode },
          rationale: justification,
          source: "engine",
          runId: run.id,
        });
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
    for (const assetId of affectedAssetIds) {
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
          runId: run.id,
        });
      }
      result.assetsRolledUp++;
    }

    await tx
      .update(engineRuns)
      .set({ status: "approved", approvedBy: actorId ?? undefined, approvedAt: new Date() })
      .where(eq(engineRuns.id, runId));
  });

  return result;
}

export async function discardRun(runId: number, actorId: number | null): Promise<EngineRun> {
  const [run] = await db.select().from(engineRuns).where(eq(engineRuns.id, runId)).limit(1);
  if (!run) throw Object.assign(new Error("Engine run not found."), { status: 404 });
  if (run.status === "approved") {
    throw Object.assign(new Error("An approved run cannot be discarded."), { status: 400 });
  }
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
