/**
 * KPI aggregates for the catalog screens (Prompt 2 §3). Computed server-side over
 * the CURRENT filtered set, with the unfiltered total shown as secondary context.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { assets, attributes, classifications, detections, reviewItems } from "@shared/models/schema";
import { CRITERION_CODES } from "@shared/lib/criteria";
import { CLASSIFICATION_CODES } from "@shared/lib/classification";
import { getSetting } from "../reference-cache";
import { resolveAssetIds, resolveAttributeIds } from "./query";
import type { FilterState } from "@shared/lib/filter-defs";

async function scalar(query: Promise<{ n: number }[]>): Promise<number> {
  const rows = await query;
  return rows[0]?.n ?? 0;
}

export async function getAttributeKpis(filters: FilterState) {
  const ids = await resolveAttributeIds(filters);
  const total = await scalar(db.select({ n: sql<number>`count(*)::int` }).from(attributes));

  if (ids.length === 0) {
    return {
      inView: 0,
      total,
      pii: 0,
      specialCategory: 0,
      analysed: 0,
      pendingReview: 0,
      uncertain: 0,
      avgConfidence: 0,
      belowThreshold: 0,
      criteriaDistribution: Object.fromEntries(CRITERION_CODES.map((c) => [c, 0])),
      classificationDistribution: {},
    };
  }

  const threshold = getSetting<number>("confidence_review_threshold") ?? 0.6;
  const inIds = inArray(detections.attributeId, ids);

  const [pii, special, analysed, uncertain] = await Promise.all([
    scalar(db.select({ n: sql<number>`count(distinct ${detections.attributeId})::int` }).from(detections).where(and(inIds, eq(detections.verdict, "pii")))),
    scalar(db.select({ n: sql<number>`count(distinct ${detections.attributeId})::int` }).from(detections).where(and(inIds, eq(detections.criterionCode, "SPECIAL_CATEGORY")))),
    scalar(db.select({ n: sql<number>`count(distinct ${detections.attributeId})::int` }).from(detections).where(inIds)),
    scalar(db.select({ n: sql<number>`count(distinct ${detections.attributeId})::int` }).from(detections).where(and(inIds, eq(detections.verdict, "uncertain")))),
  ]);

  const pendingReview = await scalar(
    db.select({ n: sql<number>`count(*)::int` }).from(reviewItems).where(and(inArray(reviewItems.targetId, ids), eq(reviewItems.targetType, "attribute"), eq(reviewItems.status, "pending"))),
  );

  const criteriaDistribution: Record<string, number> = {};
  for (const code of CRITERION_CODES) {
    criteriaDistribution[code] = await scalar(
      db.select({ n: sql<number>`count(distinct ${detections.attributeId})::int` }).from(detections).where(and(inIds, eq(detections.criterionCode, code))),
    );
  }

  // Count DISTINCT classified attributes per level so UNCLASSIFIED can't be skewed
  // by any stray duplicate active rows.
  const levelRows = await db
    .select({ level: classifications.levelCode, n: sql<number>`count(distinct ${classifications.targetId})::int` })
    .from(classifications)
    .where(and(eq(classifications.scope, "attribute"), isNull(classifications.supersededBy), inArray(classifications.targetId, ids)))
    .groupBy(classifications.levelCode);
  const classificationDistribution: Record<string, number> = {};
  for (const code of CLASSIFICATION_CODES) classificationDistribution[code] = 0;
  let classified = 0;
  for (const r of levelRows) {
    classificationDistribution[r.level] = r.n;
    classified += r.n;
  }
  classificationDistribution.UNCLASSIFIED = Math.max(0, ids.length - classified);

  const confRows = await db
    .select({ avg: sql<number>`coalesce(avg(${detections.confidence}), 0)::float`, below: sql<number>`count(*) filter (where ${detections.confidence} < ${threshold})::int` })
    .from(detections)
    .where(and(inIds, eq(detections.verdict, "pii")));

  return {
    inView: ids.length,
    total,
    pii,
    specialCategory: special,
    analysed,
    pendingReview,
    uncertain,
    avgConfidence: Number((confRows[0]?.avg ?? 0).toFixed(3)),
    belowThreshold: confRows[0]?.below ?? 0,
    criteriaDistribution,
    classificationDistribution,
  };
}

export async function getAssetKpis(filters: FilterState) {
  const ids = await resolveAssetIds(filters);
  const total = await scalar(db.select({ n: sql<number>`count(*)::int` }).from(assets));

  if (ids.length === 0) {
    return { inView: 0, total, pii: 0, cde: 0, classified: 0, avgQuality: 0, conflicts: 0, classificationDistribution: {} };
  }

  const rows = await db
    .select({ id: assets.id, piiFlag: assets.piiFlag, cdeFlag: assets.cdeFlag, level: assets.assetClassification, quality: assets.qualityScore })
    .from(assets)
    .where(inArray(assets.id, ids));
  let pii = 0;
  let cde = 0;
  let classified = 0;
  let qualitySum = 0;
  let qualityCount = 0;
  const classificationDistribution: Record<string, number> = { UNCLASSIFIED: 0 };
  for (const code of CLASSIFICATION_CODES) classificationDistribution[code] = 0;
  for (const r of rows) {
    if (r.piiFlag) pii++;
    if (r.cdeFlag) cde++;
    if (typeof r.quality === "number") {
      qualitySum += r.quality;
      qualityCount++;
    }
    if (r.level) {
      classified++;
      classificationDistribution[r.level] = (classificationDistribution[r.level] ?? 0) + 1;
    } else {
      classificationDistribution.UNCLASSIFIED++;
    }
  }

  // Assets containing at least one layer conflict among their attributes.
  const conflictRows = await db.execute(
    sql`SELECT count(distinct a.asset_id)::int AS n FROM attributes a WHERE a.asset_id = ANY(${ids}) AND EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = a.id AND d.verdict='pii') AND EXISTS (SELECT 1 FROM detections d2 WHERE d2.attribute_id = a.id AND d2.verdict='not_pii')`,
  );
  const conflicts = Number((conflictRows.rows[0] as { n?: number } | undefined)?.n ?? 0);

  return {
    inView: ids.length,
    total,
    pii,
    cde,
    classified,
    conflicts,
    avgQuality: qualityCount ? Number((qualitySum / qualityCount).toFixed(1)) : 0,
    classificationDistribution,
  };
}
