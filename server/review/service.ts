/**
 * Steward review queue. Built from detections and prioritised by:
 *   conflict between layers > 'uncertain' verdict > confidence near the decision
 *   threshold > asset criticality (CDE flag) > everything else.
 *
 * Every accept / reject / override writes an append-only audit_log entry with
 * before + after + rationale. No resolution is possible without a rationale
 * (enforced by reviewDecisionSchema at the zod layer).
 */
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  assets,
  attributes,
  detections,
  reviewItems,
  type Detection,
  type ReviewDecisionInput,
  type ReviewItem,
} from "@shared/models/schema";
import { getSetting } from "../reference-cache";
import { mergeSignals, detectionToSignal, type MergedDecision } from "../pii-engine/merge";
import { appendAudit } from "../audit";
import { applyClassificationOverride } from "../classification-engine/override";
import { badRequest, notFound } from "../http";

function computePriority(merged: MergedDecision, cde: boolean): number {
  let priority: number;
  if (merged.conflict) priority = 100;
  else if (merged.verdict === "uncertain") priority = 80;
  else if (merged.nearThreshold) priority = 60;
  else if (merged.verdict === "pii") priority = 40;
  else priority = 10;
  if (cde) priority += 5;
  return priority;
}

export async function buildReviewQueue(runId: string): Promise<number> {
  // Rebuild only the pending queue; resolved items are preserved (audited).
  await db.delete(reviewItems).where(eq(reviewItems.status, "pending"));

  const threshold = getSetting<number>("confidence_review_threshold") ?? 0.6;
  const detectionRows = await db.select().from(detections).where(eq(detections.runId, runId));
  if (detectionRows.length === 0) return 0;

  const attributeIds = [...new Set(detectionRows.map((d) => d.attributeId))];
  const attrRows = await db.select().from(attributes).where(inArray(attributes.id, attributeIds));
  const attrMap = new Map(attrRows.map((a) => [a.id, a]));
  const assetIds = [...new Set(attrRows.map((a) => a.assetId))];
  const assetRows = assetIds.length
    ? await db.select().from(assets).where(inArray(assets.id, assetIds))
    : [];
  const assetCde = new Map(assetRows.map((a) => [a.id, a.cdeFlag]));

  const byAttribute = new Map<number, Detection[]>();
  for (const row of detectionRows) {
    const list = byAttribute.get(row.attributeId) ?? [];
    list.push(row);
    byAttribute.set(row.attributeId, list);
  }

  const toInsert: Array<typeof reviewItems.$inferInsert> = [];
  for (const [attributeId, layers] of byAttribute) {
    const merged = mergeSignals(layers.map(detectionToSignal), threshold);
    // Only meaningful cases enter the queue; confident not_pii is skipped.
    if (merged.verdict === "not_pii" && !merged.conflict) continue;

    const attr = attrMap.get(attributeId);
    const cde = Boolean(attr?.cdeFlag) || Boolean(attr && assetCde.get(attr.assetId));
    const top = layers.reduce((best, d) => (d.confidence > best.confidence ? d : best));

    toInsert.push({
      targetType: "attribute",
      targetId: attributeId,
      detectionId: top.id,
      status: "pending",
      priority: computePriority(merged, cde),
    });
  }

  if (toInsert.length > 0) {
    await db.insert(reviewItems).values(toInsert);
  }
  return toInsert.length;
}

export interface ReviewItemView {
  id: number;
  targetType: ReviewItem["targetType"];
  targetId: number;
  status: ReviewItem["status"];
  priority: number;
  decisionRationale: string | null;
  resolvedAt: Date | null;
  columnName: string | null;
  assetName: string | null;
  verdict: Detection["verdict"] | null;
  criterionCode: Detection["criterionCode"] | null;
  confidence: number | null;
  detectionId: number | null;
}

export async function listReviewItems(status?: ReviewItem["status"]): Promise<ReviewItemView[]> {
  const rows = status
    ? await db.select().from(reviewItems).where(eq(reviewItems.status, status)).orderBy(desc(reviewItems.priority))
    : await db.select().from(reviewItems).orderBy(desc(reviewItems.priority));
  if (rows.length === 0) return [];

  const attrIds = [...new Set(rows.map((r) => r.targetId))];
  const attrRows = await db.select().from(attributes).where(inArray(attributes.id, attrIds));
  const attrMap = new Map(attrRows.map((a) => [a.id, a]));
  const assetIds = [...new Set(attrRows.map((a) => a.assetId))];
  const assetRows = assetIds.length
    ? await db.select().from(assets).where(inArray(assets.id, assetIds))
    : [];
  const assetMap = new Map(assetRows.map((a) => [a.id, a]));

  const detIds = rows.map((r) => r.detectionId).filter((id): id is number => id != null);
  const detRows = detIds.length
    ? await db.select().from(detections).where(inArray(detections.id, detIds))
    : [];
  const detMap = new Map(detRows.map((d) => [d.id, d]));

  return rows.map((r) => {
    const attr = attrMap.get(r.targetId);
    const asset = attr ? assetMap.get(attr.assetId) : undefined;
    const det = r.detectionId ? detMap.get(r.detectionId) : undefined;
    return {
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      status: r.status,
      priority: r.priority,
      decisionRationale: r.decisionRationale,
      resolvedAt: r.resolvedAt,
      columnName: attr?.columnName ?? null,
      assetName: asset?.name ?? null,
      verdict: det?.verdict ?? null,
      criterionCode: det?.criterionCode ?? null,
      confidence: det?.confidence ?? null,
      detectionId: r.detectionId,
    };
  });
}

export async function resolveReview(
  input: ReviewDecisionInput,
  actorId: number | null,
): Promise<ReviewItem> {
  const [item] = await db
    .select()
    .from(reviewItems)
    .where(eq(reviewItems.id, input.reviewItemId))
    .limit(1);
  if (!item) throw notFound("Review item not found.");
  if (item.status !== "pending") throw badRequest("Review item has already been resolved.");

  const before = { status: item.status, decisionRationale: item.decisionRationale };

  // An override decision that carries a level also writes a classification override.
  if (input.decision === "overridden" && input.overrideLevelCode) {
    await applyClassificationOverride(
      {
        scope: item.targetType === "asset" ? "asset" : "attribute",
        targetId: item.targetId,
        levelCode: input.overrideLevelCode,
        rationale: input.rationale,
      },
      actorId,
    );
  }

  const [updated] = await db
    .update(reviewItems)
    .set({
      status: input.decision,
      resolvedBy: actorId,
      resolvedAt: new Date(),
      decisionRationale: input.rationale,
    })
    .where(eq(reviewItems.id, item.id))
    .returning();

  await appendAudit({
    actorId,
    action: `review_${input.decision}`,
    entityType: "review_item",
    entityId: item.id,
    before,
    after: { status: input.decision, decisionRationale: input.rationale },
    rationale: input.rationale,
    source: "steward",
  });

  return updated;
}
