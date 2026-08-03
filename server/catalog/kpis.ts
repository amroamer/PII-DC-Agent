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
  const tablesTotal = await scalar(db.select({ n: sql<number>`count(*)::int` }).from(assets));

  /**
   * Coverage scope: the filters MINUS the verdict facet.
   *
   * "Analysed · N never" answers "how much of what I am looking at has been
   * looked at" — and selecting verdicts is not a change of subject, it is a
   * change of answer. Scoped to the verdict-filtered view the question becomes
   * circular: picking pii/not_pii/uncertain excludes every un-analysed column
   * by construction, so the tile reported "0 never" while 206 columns of the
   * selected catalog had never been analysed.
   */
  const coverageIds = filters.verdict === undefined ? ids : await resolveAttributeIds({ ...filters, verdict: undefined });

  if (ids.length === 0) {
    return {
      inView: 0,
      total,
      tablesTotal,
      tablesAnalysed: 0,
      pii: 0,
      specialCategory: 0,
      analysed: 0,
      notAnalysed: coverageIds.length,
      coverageScope: coverageIds.length,
      conflicts: 0,
      pendingReview: 0,
      uncertain: 0,
      avgConfidence: 0,
      belowThreshold: 0,
      criteriaDistribution: Object.fromEntries(CRITERION_CODES.map((c) => [c, 0])),
      classificationDistribution: {},
    };
  }

  const threshold = getSetting<number>("confidence_review_threshold") ?? 0.6;
  // When nothing is filtered (ids == every attribute) skip id-scoping entirely —
  // that avoids a 20k-element IN list on the common dashboard case. Otherwise scope
  // with inArray. Counts run as parallel GROUP BY passes, not ~12 sequential queries.
  const scopeAll = ids.length >= total;
  const detScope = scopeAll ? sql`true` : inArray(detections.attributeId, ids);
  const clsScope = scopeAll ? sql`true` : inArray(classifications.targetId, ids);
  const rvScope = scopeAll ? sql`true` : inArray(reviewItems.targetId, ids);

  const [verdictRows, criterionRows, levelRows, confRows, analysed, pendingReview, tablesAnalysed, conflicts] = await Promise.all([
    db.select({ verdict: detections.verdict, n: sql<number>`count(distinct ${detections.attributeId})::int` }).from(detections).where(detScope).groupBy(detections.verdict),
    db.select({ criterion: detections.criterionCode, n: sql<number>`count(distinct ${detections.attributeId})::int` }).from(detections).where(detScope).groupBy(detections.criterionCode),
    db.select({ level: classifications.levelCode, n: sql<number>`count(distinct ${classifications.targetId})::int` }).from(classifications).where(and(eq(classifications.scope, "attribute"), isNull(classifications.supersededBy), clsScope)).groupBy(classifications.levelCode),
    // Average over EVERY detection in view, not just the pii ones. Scoped to
    // `pii` it read 0% whenever the view had no PII findings — filtering to
    // "uncertain" showed "Avg conf. 0%" beside a table of 60-95% rows.
    db.select({ avg: sql<number>`coalesce(avg(${detections.confidence}), 0)::float`, below: sql<number>`count(*) filter (where ${detections.confidence} < ${threshold})::int` }).from(detections).where(detScope),
    // Analysed is measured over the COVERAGE scope, so the pair (analysed,
    // never) always sums to the columns matching the non-verdict filters.
    scalar(
      db
        .select({ n: sql<number>`count(distinct ${detections.attributeId})::int` })
        .from(detections)
        .where(coverageIds.length >= total ? sql`true` : inArray(detections.attributeId, coverageIds)),
    ),
    scalar(db.select({ n: sql<number>`count(*)::int` }).from(reviewItems).where(and(eq(reviewItems.targetType, "attribute"), eq(reviewItems.status, "pending"), rvScope))),
    // Tables (assets) with at least one analysed column.
    scalar(db.select({ n: sql<number>`count(distinct ${attributes.assetId})::int` }).from(attributes).innerJoin(detections, eq(detections.attributeId, attributes.id)).where(scopeAll ? sql`true` : inArray(attributes.id, ids))),
    // Columns with a layer conflict (both a pii and a not_pii detection).
    scalar(db.select({ n: sql<number>`count(distinct ${detections.attributeId})::int` }).from(detections).where(and(detScope, eq(detections.verdict, "pii"), sql`EXISTS (SELECT 1 FROM detections d2 WHERE d2.attribute_id = ${detections.attributeId} AND d2.verdict = 'not_pii')`))),
  ]);

  const byVerdict: Record<string, number> = {};
  for (const r of verdictRows) byVerdict[r.verdict] = r.n;

  const criteriaDistribution: Record<string, number> = {};
  for (const code of CRITERION_CODES) criteriaDistribution[code] = 0;
  for (const r of criterionRows) if (r.criterion) criteriaDistribution[r.criterion] = r.n;

  // DISTINCT classified attributes per level so UNCLASSIFIED isn't skewed by dupes.
  const classificationDistribution: Record<string, number> = {};
  for (const code of CLASSIFICATION_CODES) classificationDistribution[code] = 0;
  let classified = 0;
  for (const r of levelRows) {
    classificationDistribution[r.level] = r.n;
    classified += r.n;
  }
  // Attributes with no engine/steward classification row still carry the level
  // imported from IKC, which is what the table's Classification column renders.
  // Counting only `classifications` rows made the bar read 100% UNCLASSIFIED on
  // an imported catalog whose every row displayed a level.
  if (classified < ids.length) {
    const importedRows = await db
      .select({ level: attributes.columnDataClassification, n: sql<number>`count(*)::int` })
      .from(attributes)
      .where(
        and(
          scopeAll ? sql`true` : inArray(attributes.id, ids),
          sql`${attributes.columnDataClassification} IS NOT NULL`,
          sql`NOT EXISTS (SELECT 1 FROM classifications cl WHERE cl.scope = 'attribute' AND cl.target_id = ${attributes.id} AND cl.superseded_by IS NULL)`,
        ),
      )
      .groupBy(attributes.columnDataClassification);
    for (const r of importedRows) {
      if (!r.level) continue;
      classificationDistribution[r.level] = (classificationDistribution[r.level] ?? 0) + r.n;
      classified += r.n;
    }
  }
  classificationDistribution.UNCLASSIFIED = Math.max(0, ids.length - classified);

  return {
    inView: ids.length,
    total,
    tablesTotal,
    tablesAnalysed,
    /** Columns matching the filters ignoring verdict — `analysed + notAnalysed`. */
    coverageScope: coverageIds.length,
    notAnalysed: Math.max(0, coverageIds.length - analysed),
    pii: byVerdict.pii ?? 0,
    specialCategory: criteriaDistribution.SPECIAL_CATEGORY ?? 0,
    analysed,
    conflicts,
    pendingReview,
    uncertain: byVerdict.uncertain ?? 0,
    avgConfidence: Number((confRows[0]?.avg ?? 0).toFixed(3)),
    belowThreshold: confRows[0]?.below ?? 0,
    criteriaDistribution,
    classificationDistribution,
  };
}

export interface PiiDensityRow {
  key: string;
  label: string;
  total: number;
  analysed: number;
  pii: number;
  special: number;
  density: number; // pii / total, 0..1
}

/**
 * PII density (E): where personal data concentrates. Two breakdowns off the committed
 * `detections` — by business domain (jsonb array, unnested so each domain is its own row)
 * and the top tables by PII count. Reads committed detections, so it reflects approved +
 * auto-published ("commit & see") results. `special` uses detections.criterion_code, which
 * approve/publish now set to the headline criterion.
 */
export async function getPiiDensity(topTables = 20): Promise<{ byDomain: PiiDensityRow[]; byTable: PiiDensityRow[] }> {
  const analysed = sql`EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = at.id)`;
  const isPii = sql`EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = at.id AND d.verdict = 'pii')`;
  const isSpecial = sql`EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = at.id AND d.criterion_code = 'SPECIAL_CATEGORY')`;

  const domainRes = await db.execute(sql`
    SELECT dom AS key,
           count(DISTINCT at.id)::int AS total,
           count(DISTINCT at.id) FILTER (WHERE ${analysed})::int AS analysed,
           count(DISTINCT at.id) FILTER (WHERE ${isPii})::int AS pii,
           count(DISTINCT at.id) FILTER (WHERE ${isSpecial})::int AS special
    FROM assets a
    CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(a.business_domain) = 'array' THEN a.business_domain ELSE '[]'::jsonb END) AS dom
    JOIN attributes at ON at.asset_id = a.id
    GROUP BY dom
    HAVING count(DISTINCT at.id) > 0
    ORDER BY pii DESC, total DESC
    LIMIT 30
  `);

  const tableRes = await db.execute(sql`
    SELECT a.id AS key, a.name AS label,
           count(DISTINCT at.id)::int AS total,
           count(DISTINCT at.id) FILTER (WHERE ${analysed})::int AS analysed,
           count(DISTINCT at.id) FILTER (WHERE ${isPii})::int AS pii,
           count(DISTINCT at.id) FILTER (WHERE ${isSpecial})::int AS special
    FROM assets a
    JOIN attributes at ON at.asset_id = a.id
    GROUP BY a.id, a.name
    HAVING count(DISTINCT at.id) FILTER (WHERE ${isPii}) > 0
    ORDER BY pii DESC, total DESC
    LIMIT ${topTables}
  `);

  const toRow = (r: Record<string, unknown>): PiiDensityRow => {
    const total = Number(r.total) || 0;
    const pii = Number(r.pii) || 0;
    return {
      key: String(r.key),
      label: r.label != null ? String(r.label) : String(r.key),
      total,
      analysed: Number(r.analysed) || 0,
      pii,
      special: Number(r.special) || 0,
      density: total ? pii / total : 0,
    };
  };

  return {
    byDomain: (domainRes.rows as Record<string, unknown>[]).map(toRow),
    byTable: (tableRes.rows as Record<string, unknown>[]).map(toRow),
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
  const assetScope = ids.length >= total ? sql`true` : inArray(attributes.assetId, ids);
  const conflicts = await scalar(
    db
      .select({ n: sql<number>`count(distinct ${attributes.assetId})::int` })
      .from(attributes)
      .where(
        and(
          assetScope,
          sql`EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = ${attributes.id} AND d.verdict = 'pii')`,
          sql`EXISTS (SELECT 1 FROM detections d2 WHERE d2.attribute_id = ${attributes.id} AND d2.verdict = 'not_pii')`,
        ),
      ),
  );

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
