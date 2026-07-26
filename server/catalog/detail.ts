/**
 * Rich single-row detail assemblers for the catalog detail drawers. Each bundles
 * everything known about one attribute or one asset across the engine tables into
 * a single response — read-only. No new persistence; all data is already stored.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  assets,
  attributes,
  classifications,
  cooccurrenceFindings,
  criterionAssessments,
  detections,
  metadataCompletion,
  reviewItems,
  runItems,
} from "@shared/models/schema";
import type { ClassificationCode } from "@shared/lib/classification";
import { getSetting } from "../reference-cache";
import { detectionToSignal, mergeSignals } from "../pii-engine/merge";
import { computeAttributeCompletion } from "../classification-engine/completion";
import { rollupAssetLevel, type AttrLevel } from "../classification-engine/rollup";
import { listAudit } from "../audit";

export async function getAttributeDetail(id: number) {
  const [attribute] = await db.select().from(attributes).where(eq(attributes.id, id)).limit(1);
  if (!attribute) return null;
  const [asset] = await db.select().from(assets).where(eq(assets.id, attribute.assetId)).limit(1);

  // Per-layer detections from the most recent run that touched this attribute,
  // fused the same way the engine read-side does (mergeSignals — not persisted).
  const detRows = await db
    .select()
    .from(detections)
    .where(eq(detections.attributeId, id))
    .orderBy(desc(detections.createdAt));
  const latestRunId = detRows[0]?.runId ?? null;
  const layers = latestRunId ? detRows.filter((d) => d.runId === latestRunId) : [];
  const threshold = getSetting<number>("confidence_review_threshold") ?? 0.6;
  const merged = layers.length ? mergeSignals(layers.map(detectionToSignal), threshold) : null;

  // Latest staged run item for this attribute -> its per-criterion assessments.
  const [runItem] = await db
    .select()
    .from(runItems)
    .where(and(eq(runItems.targetType, "attribute"), eq(runItems.targetId, id)))
    .orderBy(desc(runItems.id))
    .limit(1);
  const assessments = runItem
    ? await db.select().from(criterionAssessments).where(eq(criterionAssessments.runItemId, runItem.id))
    : [];

  // Classification: active (supersededBy IS NULL) + full history, newest first.
  const clsRows = await db
    .select()
    .from(classifications)
    .where(and(eq(classifications.scope, "attribute"), eq(classifications.targetId, id)))
    .orderBy(desc(classifications.createdAt));
  const activeCls = clsRows.find((c) => c.supersededBy == null) ?? null;

  // Seven required metadata fields (5 IKC-derived + 2 PDTC-captured).
  const [completion] = await db
    .select()
    .from(metadataCompletion)
    .where(eq(metadataCompletion.attributeId, id))
    .limit(1);
  const fields = computeAttributeCompletion(attribute, asset, Boolean(activeCls), completion);

  const reviews = await db
    .select()
    .from(reviewItems)
    .where(and(eq(reviewItems.targetType, "attribute"), eq(reviewItems.targetId, id)));

  const cooccurrence = await db
    .select()
    .from(cooccurrenceFindings)
    .where(sql`${cooccurrenceFindings.attributeIds} @> ${JSON.stringify([id])}::jsonb`);

  const audit = await listAudit("attribute", String(id));

  return {
    attribute,
    asset: asset ? { id: asset.id, name: asset.name, businessDomain: asset.businessDomain } : null,
    detection: { runId: latestRunId, merged, layers },
    assessments,
    classification: { active: activeCls, history: clsRows },
    metadata: { fields, completion: completion ?? null },
    reviews,
    cooccurrence,
    audit,
  };
}

export async function getAssetDetail(id: number) {
  const [asset] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!asset) return null;

  const attrs = await db
    .select({
      id: attributes.id,
      columnName: attributes.columnName,
      dataType: attributes.dataType,
      columnDataClassification: attributes.columnDataClassification,
      piiName: attributes.piiName,
      cdeFlag: attributes.cdeFlag,
      selectedDataClassName: attributes.selectedDataClassName,
    })
    .from(attributes)
    .where(eq(attributes.assetId, id));

  // Active asset classification + history.
  const clsRows = await db
    .select()
    .from(classifications)
    .where(and(eq(classifications.scope, "asset"), eq(classifications.targetId, id)))
    .orderBy(desc(classifications.createdAt));
  const activeCls = clsRows.find((c) => c.supersededBy == null) ?? null;

  // Rollup from the attributes' ACTIVE (engine-computed) classifications, so the
  // drawer shows which columns drive the asset's high-water-mark level.
  const attrIds = attrs.map((a) => a.id);
  const attrCls = attrIds.length
    ? await db
        .select({ targetId: classifications.targetId, levelCode: classifications.levelCode })
        .from(classifications)
        .where(and(eq(classifications.scope, "attribute"), isNull(classifications.supersededBy), inArray(classifications.targetId, attrIds)))
    : [];
  const levelByAttr = new Map<number, ClassificationCode>(attrCls.map((c) => [c.targetId, c.levelCode]));
  const attrLevels: AttrLevel[] = attrs
    .filter((a) => levelByAttr.has(a.id))
    .map((a) => ({ attributeId: a.id, columnName: a.columnName, level: levelByAttr.get(a.id)! }));
  const rollup = rollupAssetLevel(attrLevels);

  const cooccurrence = await db
    .select()
    .from(cooccurrenceFindings)
    .where(eq(cooccurrenceFindings.assetId, id));

  const audit = await listAudit("asset", String(id));

  return {
    asset,
    attributes: attrs,
    classification: { active: activeCls, history: clsRows, rollup },
    cooccurrence,
    audit,
  };
}
