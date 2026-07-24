/**
 * Read-side of the PII engine: fused per-attribute results with filtering, the
 * evidence lookup, and run status counters. The fusion is recomputed here from the
 * persisted per-layer detection rows via mergeSignals().
 */
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  assets,
  attributes,
  cooccurrenceFindings,
  detections,
  type Attribute,
  type Detection,
  type DetectionVerdict,
} from "@shared/models/schema";
import { getSetting } from "../reference-cache";
import type { CriterionCode } from "@shared/lib/criteria";
import { mergeSignals, detectionToSignal, type MergedDecision } from "./merge";

export async function getLatestRunId(): Promise<string | null> {
  const [row] = await db
    .select({ runId: detections.runId })
    .from(detections)
    .orderBy(desc(detections.createdAt))
    .limit(1);
  return row?.runId ?? null;
}

export interface ResultFilters {
  runId?: string;
  criterion?: CriterionCode;
  verdict?: DetectionVerdict;
  minConfidence?: number;
  assetId?: number;
}

export interface DetectionResultRow {
  attributeId: number;
  columnName: string;
  assetId: number;
  assetName: string;
  merged: MergedDecision;
  layers: Detection[];
}

export async function getResults(filters: ResultFilters): Promise<DetectionResultRow[]> {
  const runId = filters.runId ?? (await getLatestRunId());
  if (!runId) return [];
  const threshold = getSetting<number>("confidence_review_threshold") ?? 0.6;

  const detectionRows = await db
    .select()
    .from(detections)
    .where(eq(detections.runId, runId));
  if (detectionRows.length === 0) return [];

  const attributeIds = [...new Set(detectionRows.map((d) => d.attributeId))];
  const attributeRows = await db
    .select()
    .from(attributes)
    .where(inArray(attributes.id, attributeIds));
  const attrMap = new Map<number, Attribute>(attributeRows.map((a) => [a.id, a]));

  const assetIds = [...new Set(attributeRows.map((a) => a.assetId))];
  const assetRows = assetIds.length
    ? await db.select().from(assets).where(inArray(assets.id, assetIds))
    : [];
  const assetMap = new Map(assetRows.map((a) => [a.id, a]));

  const byAttribute = new Map<number, Detection[]>();
  for (const row of detectionRows) {
    const list = byAttribute.get(row.attributeId) ?? [];
    list.push(row);
    byAttribute.set(row.attributeId, list);
  }

  const results: DetectionResultRow[] = [];
  for (const [attributeId, layers] of byAttribute) {
    const attribute = attrMap.get(attributeId);
    if (!attribute) continue;
    const asset = assetMap.get(attribute.assetId);
    const merged = mergeSignals(layers.map(detectionToSignal), threshold);

    if (filters.verdict && merged.verdict !== filters.verdict) continue;
    if (filters.criterion && merged.criterion !== filters.criterion) continue;
    if (filters.minConfidence != null && merged.confidence < filters.minConfidence) continue;
    if (filters.assetId != null && attribute.assetId !== filters.assetId) continue;

    results.push({
      attributeId,
      columnName: attribute.columnName,
      assetId: attribute.assetId,
      assetName: asset?.name ?? "(unknown asset)",
      merged,
      layers,
    });
  }

  results.sort((a, b) => b.merged.confidence - a.merged.confidence);
  return results;
}

export async function getEvidence(detectionId: number) {
  const [detection] = await db
    .select()
    .from(detections)
    .where(eq(detections.id, detectionId))
    .limit(1);
  if (!detection) return null;

  const [attribute] = await db
    .select()
    .from(attributes)
    .where(eq(attributes.id, detection.attributeId))
    .limit(1);
  const asset = attribute
    ? (await db.select().from(assets).where(eq(assets.id, attribute.assetId)).limit(1))[0]
    : undefined;

  return { detection, attribute, asset };
}

export interface RunStatus {
  runId: string;
  detections: number;
  attributes: number;
  verdicts: Record<DetectionVerdict, number>;
  byCriterion: Record<string, number>;
  cooccurrenceFindings: number;
}

export async function getRunStatus(runId: string): Promise<RunStatus> {
  const rows = await db.select().from(detections).where(eq(detections.runId, runId));
  const verdicts: Record<DetectionVerdict, number> = { pii: 0, not_pii: 0, uncertain: 0 };
  const byCriterion: Record<string, number> = {};
  const attributeIds = new Set<number>();

  for (const row of rows) {
    verdicts[row.verdict] = (verdicts[row.verdict] ?? 0) + 1;
    if (row.criterionCode) byCriterion[row.criterionCode] = (byCriterion[row.criterionCode] ?? 0) + 1;
    attributeIds.add(row.attributeId);
  }

  const cooccur = await db
    .select()
    .from(cooccurrenceFindings)
    .where(eq(cooccurrenceFindings.runId, runId));

  return {
    runId,
    detections: rows.length,
    attributes: attributeIds.size,
    verdicts,
    byCriterion,
    cooccurrenceFindings: cooccur.length,
  };
}
