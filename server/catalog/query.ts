/**
 * Server-side list / filter / sort / pagination for the catalog screens. Filtering
 * NEVER happens in the browser — these tables reach tens of thousands of rows.
 * Predicates are built from the shared FilterDefinition set; unimplemented keys are
 * treated as no-ops (documented in filter-defs.ts).
 */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "../db";
import {
  assets,
  attributes,
  detections,
  reviewItems,
  type DetectionLayer,
  type DetectionVerdict,
} from "@shared/models/schema";
import { SPECIAL_CATEGORY_CODE, type CriterionCode } from "@shared/lib/criteria";
import type { CatalogScreen, FilterState } from "@shared/lib/filter-defs";
import { getSetting } from "../reference-cache";
import { detectionToSignal, mergeSignals } from "../pii-engine/merge";

/** Fused detection state joined onto each attribute row of a catalog page. */
export interface AttributeDetectionSummary {
  verdict: DetectionVerdict | null;
  criterion: CriterionCode | null;
  confidence: number | null;
  dataClassCode: string | null;
  rationaleEn: string | null;
  rationaleAr: string | null;
  conflict: boolean;
  nearThreshold: boolean;
  reviewStatus: string | null;
}

export interface ListParams {
  filters: FilterState;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)) : v == null || v === "" ? [] : [String(v)];

/**
 * A bound `IN (...)` value list. drizzle's `sql` template mis-binds a JS array for
 * `= ANY(${array})` (Postgres: "op ANY/ALL (array) requires array on right side"),
 * so build an explicit parameter list instead. Callers must guard against empty input.
 */
const inList = (values: Array<string | number>): SQL => sql.join(values.map((v) => sql`${v}`), sql`, `);

/**
 * Overlap predicate for a jsonb string[] column: true when the stored array shares
 * ANY of `values`. `jsonb_exists_any` is the function form of the `?|` operator
 * (avoids the `?` placeholder ambiguity). Callers must guard against empty input.
 */
const jsonbOverlap = (col: any, values: string[]): SQL =>
  sql`jsonb_exists_any(${col}, ARRAY[${inList(values)}]::text[])`;

/** Asset facets stored as jsonb string[] (parsed from IKC list literals at import). */
const JSONB_ARRAY_KEYS = new Set(["businessDomain", "subjectArea", "department", "sector", "stewards"]);
/** Their snake_case column names, for the distinct-options unnest query. */
const JSONB_ARRAY_COLS: Record<string, string> = {
  businessDomain: "business_domain",
  subjectArea: "subject_area",
  department: "department",
  sector: "sector",
  stewards: "stewards",
};

function tristate(col: ReturnType<typeof eq> extends never ? never : any, v: unknown): SQL | undefined {
  if (v === true || v === "yes" || v === "true") return eq(col, true);
  if (v === false || v === "no" || v === "false") return eq(col, false);
  return undefined;
}

function existsCol(col: any, present: unknown): SQL | undefined {
  if (present === true || present === "yes") return isNotNull(col);
  if (present === false || present === "no") return isNull(col);
  return undefined;
}

function numRange(col: any, v: unknown): SQL | undefined {
  if (!v || typeof v !== "object") return undefined;
  const { min, max } = v as { min?: number; max?: number };
  const parts: SQL[] = [];
  if (typeof min === "number") parts.push(gte(col, min));
  if (typeof max === "number") parts.push(lte(col, max));
  return parts.length ? and(...parts) : undefined;
}

function dateRange(col: any, v: unknown): SQL | undefined {
  if (!v || typeof v !== "object") return undefined;
  const { from, to } = v as { from?: string; to?: string };
  const parts: SQL[] = [];
  if (from) parts.push(gte(col, new Date(from)));
  if (to) parts.push(lte(col, new Date(to)));
  return parts.length ? and(...parts) : undefined;
}

// --------------------------------------------------------------------------
// Assets
// --------------------------------------------------------------------------
function assetConditions(filters: FilterState): SQL[] {
  const c: (SQL | undefined)[] = [];
  const f = filters;

  if (f.search) {
    const term = `%${String(f.search)}%`;
    c.push(or(ilike(assets.name, term), ilike(assets.descriptionEn, term), ilike(assets.descriptionAr, term), ilike(assets.ikcAssetId, term)));
  }
  if (f.ikcAssetId) c.push(ilike(assets.ikcAssetId, `%${String(f.ikcAssetId)}%`));
  if (f.name) c.push(ilike(assets.name, `%${String(f.name)}%`));
  if (arr(f.assetType).length) c.push(inArray(assets.assetType, arr(f.assetType)));
  if (arr(f.businessDomain).length) c.push(jsonbOverlap(assets.businessDomain, arr(f.businessDomain)));
  if (arr(f.subjectArea).length) c.push(jsonbOverlap(assets.subjectArea, arr(f.subjectArea)));
  if (arr(f.department).length) c.push(jsonbOverlap(assets.department, arr(f.department)));
  if (arr(f.sector).length) c.push(jsonbOverlap(assets.sector, arr(f.sector)));
  if (arr(f.ownerId).length) c.push(inArray(assets.ownerId, arr(f.ownerId)));
  if (arr(f.storage).length) c.push(inArray(assets.storage, arr(f.storage)));
  if (arr(f.retentionPeriod).length) c.push(inArray(assets.retentionPeriod, arr(f.retentionPeriod)));
  if (arr(f.assetClassification).length) {
    const values = arr(f.assetClassification);
    const conds: (SQL | undefined)[] = [];
    const real = values.filter((v) => v !== "UNCLASSIFIED");
    if (real.length) conds.push(inArray(assets.assetClassification as any, real));
    if (values.includes("UNCLASSIFIED")) conds.push(isNull(assets.assetClassification));
    c.push(or(...(conds.filter(Boolean) as SQL[])));
  }
  if (arr(f.stewards).length) c.push(jsonbOverlap(assets.stewards, arr(f.stewards)));
  if (arr(f.creatorId).length) c.push(inArray(assets.creatorId, arr(f.creatorId)));
  if (arr(f.catalogId).length) c.push(inArray(assets.catalogId, arr(f.catalogId)));
  if (arr(f.tableType).length) c.push(inArray(assets.tableType, arr(f.tableType)));
  if (arr(f.tableSchema).length) c.push(inArray(assets.tableSchema, arr(f.tableSchema)));
  if (arr(f.connectionId).length) c.push(inArray(assets.connectionId, arr(f.connectionId)));
  if (arr(f.backupFrequency).length) c.push(inArray(assets.backupFrequency, arr(f.backupFrequency)));
  c.push(numRange(assets.numColumns, f.numColumns));
  c.push(numRange(assets.numChildren, f.numChildren));
  c.push(numRange(assets.qualityScore, f.qualityScore));
  c.push(numRange(assets.analysedRowCount, f.analysedRowCount));
  c.push(tristate(assets.piiFlag, f.piiFlag));
  c.push(tristate(assets.cdeFlag, f.cdeFlag));

  // Classification source (derived from the active classification row for the asset).
  if (typeof f.classificationSource === "string") {
    const s = f.classificationSource;
    if (s === "none") c.push(sql`NOT EXISTS (SELECT 1 FROM classifications cl WHERE cl.scope = 'asset' AND cl.target_id = ${assets.id} AND cl.superseded_by IS NULL)`);
    else c.push(sql`EXISTS (SELECT 1 FROM classifications cl WHERE cl.scope = 'asset' AND cl.target_id = ${assets.id} AND cl.superseded_by IS NULL AND cl.derived_from = ${s})`);
  }
  // Asset contains a layer conflict / uncertain verdict among its attributes.
  if (f.containsConflicts === true) {
    c.push(sql`EXISTS (SELECT 1 FROM attributes a JOIN detections d ON d.attribute_id = a.id AND d.verdict = 'pii' JOIN detections d2 ON d2.attribute_id = a.id AND d2.verdict = 'not_pii' WHERE a.asset_id = ${assets.id})`);
  }
  if (f.containsUncertain === true) {
    c.push(sql`EXISTS (SELECT 1 FROM attributes a JOIN detections d ON d.attribute_id = a.id WHERE a.asset_id = ${assets.id} AND d.verdict = 'uncertain')`);
  }

  c.push(existsCol(assets.descriptionEn, f.hasEnDescription));
  c.push(existsCol(assets.descriptionAr, f.hasArDescription));
  c.push(existsCol(assets.ownerId, f.hasOwner));
  c.push(existsCol(assets.stewards, f.hasStewards));
  c.push(existsCol(assets.businessDomain, f.hasBusinessDomain));

  return c.filter((x): x is SQL => x !== undefined);
}

const ASSET_SORT: Record<string, any> = {
  name: assets.name,
  ikcAssetId: assets.ikcAssetId,
  assetType: assets.assetType,
  businessDomain: assets.businessDomain,
  assetClassification: assets.assetClassification,
  id: assets.id,
};

export async function listAssets(params: ListParams) {
  const conds = assetConditions(params.filters);
  const where = conds.length ? and(...conds) : undefined;
  const pageSize = Math.min(Math.max(params.pageSize ?? 50, 1), 200);
  const page = Math.max(params.page ?? 1, 1);
  const sortCol = ASSET_SORT[params.sort ?? "name"] ?? assets.name;
  const order = params.dir === "desc" ? desc(sortCol) : asc(sortCol);

  const rows = await db.select().from(assets).where(where).orderBy(order).limit(pageSize).offset((page - 1) * pageSize);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(assets).where(where);
  return { rows, total: n ?? 0, page, pageSize };
}

export async function resolveAssetIds(filters: FilterState): Promise<number[]> {
  const conds = assetConditions(filters);
  const rows = await db.select({ id: assets.id }).from(assets).where(conds.length ? and(...conds) : undefined);
  return rows.map((r) => r.id);
}

/**
 * Tables (assets) that match the given ATTRIBUTE-screen filters, each with the count of
 * matching attributes — the picklist behind the run wizard's "Filter / pick tables" scope.
 * The `assetId` filter (which tables are already picked) is ignored so the list itself never
 * shrinks to the selection. Sorted by attribute count by default (main sort, asc/desc).
 */
export async function listScopeTables(
  filters: FilterState,
  sort: "attributes" | "name",
  dir: "asc" | "desc",
  limit = 500,
) {
  const f: FilterState = { ...filters };
  delete (f as Record<string, unknown>).assetId;
  const conds = attributeConditions(f);
  const where = conds.length ? and(...conds) : undefined;
  const attributeCount = sql<number>`count(${attributes.id})::int`;
  const analysedCount = sql<number>`count(${attributes.id}) FILTER (WHERE EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = ${attributes.id}))::int`;
  const piiCount = sql<number>`count(${attributes.id}) FILTER (WHERE EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = ${attributes.id} AND d.verdict = 'pii'))::int`;
  const orderExpr = sort === "name" ? assets.name : sql`count(${attributes.id})`;
  return db
    .select({
      id: assets.id,
      name: assets.name,
      businessDomain: assets.businessDomain,
      attributeCount,
      analysedCount,
      piiCount,
    })
    .from(attributes)
    .innerJoin(assets, eq(attributes.assetId, assets.id))
    .where(where)
    .groupBy(assets.id, assets.name, assets.businessDomain)
    .orderBy(dir === "desc" ? desc(orderExpr) : asc(orderExpr), asc(assets.name))
    .limit(limit);
}

// --------------------------------------------------------------------------
// Attributes (joined to parent asset for inherited-context filters)
// --------------------------------------------------------------------------
function attributeConditions(filters: FilterState): SQL[] {
  const c: (SQL | undefined)[] = [];
  const f = filters;

  if (f.search) {
    const term = `%${String(f.search)}%`;
    c.push(or(ilike(attributes.columnName, term), ilike(attributes.descriptionEn, term), ilike(attributes.descriptionAr, term), ilike(assets.name, term)));
  }
  if (f.columnName) c.push(ilike(attributes.columnName, `%${String(f.columnName)}%`));
  // "Asset" filter selects parent assets by NAME (searchable + human-readable).
  if (arr(f.assetId).length) c.push(inArray(assets.name, arr(f.assetId)));
  if (arr(f.dataType).length) c.push(inArray(attributes.dataType, arr(f.dataType)));
  if (arr(f.nativeType).length) c.push(inArray(attributes.nativeType, arr(f.nativeType)));
  c.push(tristate(attributes.nullable, f.nullable));
  c.push(tristate(attributes.isPrimaryKey, f.isPrimaryKey));
  c.push(tristate(attributes.cdeFlag, f.cdeFlag));
  if (arr(f.selectedDataClassName).length) c.push(inArray(attributes.selectedDataClassName, arr(f.selectedDataClassName)));
  if (f.hasSuggestedClasses === true) c.push(isNotNull(attributes.suggestedClasses));
  else if (f.hasSuggestedClasses === false) c.push(isNull(attributes.suggestedClasses));
  if (arr(f.businessDomain).length) c.push(jsonbOverlap(assets.businessDomain, arr(f.businessDomain)));
  if (arr(f.subjectArea).length) c.push(jsonbOverlap(assets.subjectArea, arr(f.subjectArea)));
  if (arr(f.department).length) c.push(jsonbOverlap(assets.department, arr(f.department)));
  if (arr(f.sector).length) c.push(jsonbOverlap(assets.sector, arr(f.sector)));
  if (arr(f.storage).length) c.push(inArray(assets.storage, arr(f.storage)));
  if (arr(f.assetType).length) c.push(inArray(assets.assetType, arr(f.assetType)));
  c.push(tristate(assets.cdeFlag, f.parentIsCde));
  c.push(numRange(attributes.length, f.length));
  c.push(numRange(attributes.scale, f.scale));
  c.push(tristate(attributes.signed, f.signed));
  c.push(numRange(attributes.qualityScore, f.qualityScore));
  c.push(numRange(attributes.selectedDataClassConfidence, f.selectedDataClassConfidence));
  c.push(existsCol(attributes.businessTerms, f.hasBusinessTerms));
  if (f.hasSuggestedTerms === true) c.push(isNotNull(attributes.suggestedTerms));
  else if (f.hasSuggestedTerms === false) c.push(isNull(attributes.suggestedTerms));
  if (arr(f.piiName).length) c.push(inArray(attributes.piiName, arr(f.piiName)));
  if (arr(f.parentClassification).length) {
    const values = arr(f.parentClassification);
    const conds: (SQL | undefined)[] = [];
    const real = values.filter((v) => v !== "UNCLASSIFIED");
    if (real.length) conds.push(inArray(assets.assetClassification as any, real));
    if (values.includes("UNCLASSIFIED")) conds.push(isNull(assets.assetClassification));
    c.push(or(...(conds.filter(Boolean) as SQL[])));
  }
  if (arr(f.columnDataClassification).length) {
    const values = arr(f.columnDataClassification);
    const conds: (SQL | undefined)[] = [];
    const real = values.filter((v) => v !== "UNCLASSIFIED");
    if (real.length) conds.push(inArray(attributes.columnDataClassification as any, real));
    if (values.includes("UNCLASSIFIED")) conds.push(isNull(attributes.columnDataClassification));
    c.push(or(...(conds.filter(Boolean) as SQL[])));
  }
  c.push(existsCol(attributes.descriptionEn, f.hasEnDescription));
  c.push(existsCol(attributes.descriptionAr, f.hasArDescription));

  // Detection-derived predicates via correlated EXISTS on the detections table.
  // Multi-select: OR across the picked verdicts; "not_analysed" means no detection rows at all.
  if (arr(f.verdict).length) {
    const values = arr(f.verdict);
    const real = values.filter((v) => v !== "not_analysed");
    const conds: SQL[] = [];
    if (real.length) conds.push(sql`EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = ${attributes.id} AND d.verdict IN (${inList(real)}))`);
    if (values.includes("not_analysed")) conds.push(sql`NOT EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = ${attributes.id})`);
    if (conds.length) c.push(or(...conds));
  }
  if (arr(f.criterion).length) {
    c.push(sql`EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = ${attributes.id} AND d.criterion_code IN (${inList(arr(f.criterion))}))`);
  }
  if (f.specialCategory === true) {
    c.push(sql`EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = ${attributes.id} AND d.criterion_code = ${SPECIAL_CATEGORY_CODE})`);
  }
  // Layers in conflict: at least one pii AND at least one not_pii detection.
  if (f.conflict === true) {
    c.push(sql`EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = ${attributes.id} AND d.verdict = 'pii') AND EXISTS (SELECT 1 FROM detections d2 WHERE d2.attribute_id = ${attributes.id} AND d2.verdict = 'not_pii')`);
  }
  // Consent status lives in metadata_completion (Not set = no row / null).
  if (arr(f.consentStatus).length) {
    const values = arr(f.consentStatus);
    const real = values.filter((v) => v !== "Not set");
    const conds: SQL[] = [];
    if (real.length) conds.push(sql`EXISTS (SELECT 1 FROM metadata_completion mc WHERE mc.attribute_id = ${attributes.id} AND mc.consent_status IN (${inList(real)}))`);
    if (values.includes("Not set")) conds.push(sql`NOT EXISTS (SELECT 1 FROM metadata_completion mc WHERE mc.attribute_id = ${attributes.id} AND mc.consent_status IS NOT NULL)`);
    if (conds.length) c.push(or(...conds));
  }
  if (f.reviewStatus && f.reviewStatus !== "not_queued") {
    c.push(sql`EXISTS (SELECT 1 FROM review_items r WHERE r.target_id = ${attributes.id} AND r.target_type = 'attribute' AND r.status = ${String(f.reviewStatus)})`);
  } else if (f.reviewStatus === "not_queued") {
    c.push(sql`NOT EXISTS (SELECT 1 FROM review_items r WHERE r.target_id = ${attributes.id} AND r.target_type = 'attribute')`);
  }

  // Detection source layer, engine confidence range, criteria-count range, co-occurrence.
  if (arr(f.sourceLayer).length) {
    c.push(sql`EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = ${attributes.id} AND d.layer IN (${inList(arr(f.sourceLayer))}))`);
  }
  if (f.engineConfidence && typeof f.engineConfidence === "object") {
    const { min, max } = f.engineConfidence as { min?: number; max?: number };
    if (typeof min === "number") c.push(sql`EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = ${attributes.id} AND d.confidence >= ${min})`);
    if (typeof max === "number") c.push(sql`EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = ${attributes.id} AND d.confidence <= ${max})`);
  }
  if (f.criteriaCount && typeof f.criteriaCount === "object") {
    const { min, max } = f.criteriaCount as { min?: number; max?: number };
    if (typeof min === "number") c.push(sql`(SELECT count(distinct d.criterion_code) FROM detections d WHERE d.attribute_id = ${attributes.id} AND d.verdict = 'pii') >= ${min}`);
    if (typeof max === "number") c.push(sql`(SELECT count(distinct d.criterion_code) FROM detections d WHERE d.attribute_id = ${attributes.id} AND d.verdict = 'pii') <= ${max}`);
  }
  if (f.cooccurrence === true) {
    c.push(sql`EXISTS (SELECT 1 FROM cooccurrence_findings cf WHERE cf.attribute_ids @> to_jsonb(${attributes.id}))`);
  }
  if (typeof f.classificationSource === "string") {
    const s = f.classificationSource;
    if (s === "none") c.push(sql`NOT EXISTS (SELECT 1 FROM classifications cl WHERE cl.scope = 'attribute' AND cl.target_id = ${attributes.id} AND cl.superseded_by IS NULL)`);
    else c.push(sql`EXISTS (SELECT 1 FROM classifications cl WHERE cl.scope = 'attribute' AND cl.target_id = ${attributes.id} AND cl.superseded_by IS NULL AND cl.derived_from = ${s})`);
  }
  // Governance metadata (metadata_completion).
  if (arr(f.accessControlLevel).length) {
    c.push(sql`EXISTS (SELECT 1 FROM metadata_completion mc WHERE mc.attribute_id = ${attributes.id} AND mc.access_control_level IN (${inList(arr(f.accessControlLevel))}))`);
  }
  c.push(f.processingPurposePresent === true ? sql`EXISTS (SELECT 1 FROM metadata_completion mc WHERE mc.attribute_id = ${attributes.id} AND mc.processing_purpose IS NOT NULL)` : f.processingPurposePresent === false ? sql`NOT EXISTS (SELECT 1 FROM metadata_completion mc WHERE mc.attribute_id = ${attributes.id} AND mc.processing_purpose IS NOT NULL)` : undefined);
  // Review assignment + engine-run + last-analysed.
  if (arr(f.assignedTo).length) {
    c.push(sql`EXISTS (SELECT 1 FROM review_items r WHERE r.target_id = ${attributes.id} AND r.target_type = 'attribute' AND r.assigned_to IN (${inList(arr(f.assignedTo).map(Number))}))`);
  }
  if (arr(f.resolvedBy).length) {
    c.push(sql`EXISTS (SELECT 1 FROM review_items r WHERE r.target_id = ${attributes.id} AND r.target_type = 'attribute' AND r.resolved_by IN (${inList(arr(f.resolvedBy).map(Number))}))`);
  }
  if (arr(f.engineRun).length) {
    c.push(sql`EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = ${attributes.id} AND d.run_id IN (${inList(arr(f.engineRun))}))`);
  }
  if (f.lastAnalysed && typeof f.lastAnalysed === "object") {
    const { from, to } = f.lastAnalysed as { from?: string; to?: string };
    if (from) c.push(sql`EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = ${attributes.id} AND d.created_at >= ${new Date(from)})`);
    if (to) c.push(sql`EXISTS (SELECT 1 FROM detections d WHERE d.attribute_id = ${attributes.id} AND d.created_at <= ${new Date(to)})`);
  }

  return c.filter((x): x is SQL => x !== undefined);
}

const ATTR_SORT: Record<string, any> = {
  columnName: attributes.columnName,
  dataType: attributes.dataType,
  assetName: assets.name,
  id: attributes.id,
  piiType: attributes.piiName,
  // Detection-derived sorts. Correlated subqueries rather than a join so the
  // count query and the page query keep the same shape.
  confidence: sql`(SELECT max(d.confidence) FROM detections d WHERE d.attribute_id = ${attributes.id})`,
  criterion: sql`(SELECT min(d.criterion_code) FROM detections d WHERE d.attribute_id = ${attributes.id} AND d.criterion_code IS NOT NULL)`,
};

export async function listAttributes(params: ListParams) {
  const conds = attributeConditions(params.filters);
  const where = conds.length ? and(...conds) : undefined;
  const pageSize = Math.min(Math.max(params.pageSize ?? 50, 1), 200);
  const page = Math.max(params.page ?? 1, 1);
  const sortCol = ATTR_SORT[params.sort ?? "columnName"] ?? attributes.columnName;
  const order = params.dir === "desc" ? desc(sortCol) : asc(sortCol);

  const rows = await db
    .select({
      id: attributes.id,
      assetId: attributes.assetId,
      columnName: attributes.columnName,
      descriptionEn: attributes.descriptionEn,
      dataType: attributes.dataType,
      nativeType: attributes.nativeType,
      nullable: attributes.nullable,
      isPrimaryKey: attributes.isPrimaryKey,
      selectedDataClassName: attributes.selectedDataClassName,
      columnDataClassification: attributes.columnDataClassification,
      piiName: attributes.piiName,
      cdeFlag: attributes.cdeFlag,
      assetName: assets.name,
      businessDomain: assets.businessDomain,
    })
    .from(attributes)
    .innerJoin(assets, eq(attributes.assetId, assets.id))
    .where(where)
    .orderBy(order)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attributes)
    .innerJoin(assets, eq(attributes.assetId, assets.id))
    .where(where);

  return { rows: await withDetectionSummary(rows), total: n ?? 0, page, pageSize };
}

/**
 * Attach the fused PII verdict + review status to a page of attribute rows.
 *
 * The fusion is recomputed with the engine's own mergeSignals() rather than
 * approximated in SQL — the merge is precedence- and conflict-aware and a
 * hand-rolled `max(confidence)` would quietly disagree with the detection screen.
 * Only the visible page (≤200 rows) is enriched, so this is two small queries.
 */
async function withDetectionSummary<T extends { id: number }>(rows: T[]): Promise<Array<T & AttributeDetectionSummary>> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [detectionRows, reviewRows] = await Promise.all([
    db.select().from(detections).where(inArray(detections.attributeId, ids)),
    db
      .select({ targetId: reviewItems.targetId, status: reviewItems.status })
      .from(reviewItems)
      .where(and(eq(reviewItems.targetType, "attribute"), inArray(reviewItems.targetId, ids))),
  ]);

  return attachDetectionSummary(rows, detectionRows, reviewRows, getSetting<number>("confidence_review_threshold") ?? 0.6);
}

/** Detection fields the summary needs — a structural subset of a `detections` row. */
export interface SummaryDetection {
  attributeId: number;
  runId: string;
  createdAt: Date;
  layer: DetectionLayer;
  verdict: DetectionVerdict;
  criterionCode: CriterionCode | null;
  dataClassCode: string | null;
  confidence: number;
  rationaleEn: string | null;
  rationaleAr: string | null;
}

/** Pure half of {@link withDetectionSummary} — no db access, so it can be tested directly. */
export function attachDetectionSummary<T extends { id: number }>(
  rows: T[],
  detectionRows: SummaryDetection[],
  reviewRows: Array<{ targetId: number; status: string }>,
  threshold = 0.6,
): Array<T & AttributeDetectionSummary> {
  // Scope to each attribute's OWN most recent run. A single global "latest run"
  // would blank every column last analysed by an earlier run — this catalog has
  // several — while merging across runs would fabricate conflicts from verdicts
  // that a later pass already superseded.
  const latestRunOf = new Map<number, { runId: string; at: number }>();
  for (const d of detectionRows) {
    const at = d.createdAt instanceof Date ? d.createdAt.getTime() : 0;
    const best = latestRunOf.get(d.attributeId);
    if (!best || at > best.at) latestRunOf.set(d.attributeId, { runId: d.runId, at });
  }

  const byAttribute = new Map<number, SummaryDetection[]>();
  for (const d of detectionRows) {
    if (d.runId !== latestRunOf.get(d.attributeId)?.runId) continue;
    const list = byAttribute.get(d.attributeId) ?? [];
    list.push(d);
    byAttribute.set(d.attributeId, list);
  }

  const reviewByAttribute = new Map<number, string>();
  for (const r of reviewRows) {
    // Pending outranks a resolved row when an attribute has been queued twice.
    if (r.status === "pending" || !reviewByAttribute.has(r.targetId)) reviewByAttribute.set(r.targetId, r.status);
  }

  return rows.map((row) => {
    const layers = byAttribute.get(row.id);
    const merged = layers?.length
      ? mergeSignals(layers.map((l) => detectionToSignal(l as never)), threshold)
      : null;
    return {
      ...row,
      verdict: merged?.verdict ?? null,
      criterion: merged?.criterion ?? null,
      confidence: merged?.confidence ?? null,
      dataClassCode: merged?.dataClassCode ?? null,
      rationaleEn: merged?.rationaleEn ?? null,
      rationaleAr: merged?.rationaleAr ?? null,
      conflict: merged?.conflict ?? false,
      nearThreshold: merged?.nearThreshold ?? false,
      reviewStatus: reviewByAttribute.get(row.id) ?? null,
    };
  });
}

export async function resolveAttributeIds(filters: FilterState): Promise<number[]> {
  const conds = attributeConditions(filters);
  const rows = await db
    .select({ id: attributes.id })
    .from(attributes)
    .innerJoin(assets, eq(attributes.assetId, assets.id))
    .where(conds.length ? and(...conds) : undefined);
  return rows.map((r) => r.id);
}

// --------------------------------------------------------------------------
// Distinct filter options (cached) + selection resolution
// --------------------------------------------------------------------------
const DISTINCT_COLUMNS: Record<CatalogScreen, Record<string, any>> = {
  assets: {
    assetType: assets.assetType,
    businessDomain: assets.businessDomain,
    subjectArea: assets.subjectArea,
    department: assets.department,
    sector: assets.sector,
    ownerId: assets.ownerId,
    stewards: assets.stewards,
    creatorId: assets.creatorId,
    catalogId: assets.catalogId,
    tableType: assets.tableType,
    tableSchema: assets.tableSchema,
    connectionId: assets.connectionId,
    backupFrequency: assets.backupFrequency,
    storage: assets.storage,
    retentionPeriod: assets.retentionPeriod,
  },
  attributes: {
    dataType: attributes.dataType,
    nativeType: attributes.nativeType,
    selectedDataClassName: attributes.selectedDataClassName,
    piiName: attributes.piiName,
    businessDomain: assets.businessDomain,
    subjectArea: assets.subjectArea,
    department: assets.department,
    sector: assets.sector,
    storage: assets.storage,
    assetType: assets.assetType,
    assetId: assets.name,
  },
};

// Attribute keys whose distinct values come from the joined asset table.
const ATTR_ASSET_JOIN_KEYS = new Set([
  "businessDomain",
  "subjectArea",
  "assetId",
  "department",
  "sector",
  "storage",
  "assetType",
]);

const distinctCache = new Map<string, { value: string; count: number }[]>();

export function invalidateDistinctCache(): void {
  distinctCache.clear();
}

export async function distinctOptions(screen: CatalogScreen, key: string) {
  const cacheKey = `${screen}:${key}`;
  const cached = distinctCache.get(cacheKey);
  if (cached) return cached;

  // Options sourced from tables other than assets/attributes.
  const RAW_OPTION_SQL: Record<string, ReturnType<typeof sql>> = {
    consentStatus: sql`SELECT consent_status AS value, count(*)::int AS count FROM metadata_completion WHERE consent_status IS NOT NULL GROUP BY consent_status ORDER BY consent_status`,
    accessControlLevel: sql`SELECT access_control_level AS value, count(*)::int AS count FROM metadata_completion WHERE access_control_level IS NOT NULL GROUP BY access_control_level ORDER BY access_control_level`,
    engineRun: sql`SELECT run_id AS value, count(*)::int AS count FROM detections GROUP BY run_id ORDER BY run_id DESC LIMIT 100`,
  };
  if (screen === "attributes" && RAW_OPTION_SQL[key]) {
    const rows = await db.execute(RAW_OPTION_SQL[key]);
    const result = (rows.rows as Array<{ value: string; count: number }>).map((r) => ({ value: String(r.value), count: Number(r.count) }));
    distinctCache.set(cacheKey, result);
    return result;
  }

  // jsonb string[] facets (business_domain, …): unnest so each element is its own option.
  // These are asset-sourced; on the attributes screen they come from the joined asset.
  if (JSONB_ARRAY_KEYS.has(key)) {
    const colName = JSONB_ARRAY_COLS[key];
    const q =
      screen === "attributes"
        ? sql.raw(
            `SELECT elem AS value, count(*)::int AS count ` +
              `FROM attributes a JOIN assets s ON a.asset_id = s.id, LATERAL jsonb_array_elements_text(s.${colName}) AS elem ` +
              `WHERE s.${colName} IS NOT NULL AND jsonb_typeof(s.${colName}) = 'array' GROUP BY elem ORDER BY elem`,
          )
        : sql.raw(
            `SELECT elem AS value, count(*)::int AS count ` +
              `FROM assets, LATERAL jsonb_array_elements_text(${colName}) AS elem ` +
              `WHERE ${colName} IS NOT NULL AND jsonb_typeof(${colName}) = 'array' GROUP BY elem ORDER BY elem`,
          );
    const rows = await db.execute(q);
    const result = (rows.rows as Array<{ value: string; count: number }>).map((r) => ({ value: String(r.value), count: Number(r.count) }));
    distinctCache.set(cacheKey, result);
    return result;
  }

  const col = DISTINCT_COLUMNS[screen]?.[key];
  if (!col) return [];

  const base =
    screen === "attributes" && ATTR_ASSET_JOIN_KEYS.has(key)
      ? db.select({ value: col, count: sql<number>`count(*)::int` }).from(attributes).innerJoin(assets, eq(attributes.assetId, assets.id))
      : db.select({ value: col, count: sql<number>`count(*)::int` }).from(screen === "assets" ? assets : attributes);

  const rows = await base.where(isNotNull(col)).groupBy(col).orderBy(col);
  const result = rows.map((r) => ({ value: String(r.value), count: r.count })).filter((r) => r.value !== "");
  distinctCache.set(cacheKey, result);
  return result;
}

export interface Selection {
  mode: "none" | "include" | "all-matching";
  ids?: number[];
  filters?: FilterState;
  excluded?: number[];
}

/** Pure selection math (unit-tested): include ignores `all`; all-matching = all − excluded. */
export function resolveSelectionIds(allMatching: number[], selection: Selection): number[] {
  if (selection.mode === "none") return [];
  if (selection.mode === "include") return selection.ids ?? [];
  const excluded = new Set(selection.excluded ?? []);
  return allMatching.filter((id) => !excluded.has(id));
}

export async function resolveSelection(
  screen: CatalogScreen,
  selection: Selection,
): Promise<number[]> {
  const maxBatch = getSetting<number>("max_batch_size") ?? 5000;

  const all =
    selection.mode === "all-matching"
      ? screen === "assets"
        ? await resolveAssetIds(selection.filters ?? {})
        : await resolveAttributeIds(selection.filters ?? {})
      : [];
  const ids = resolveSelectionIds(all, selection);

  if (ids.length > maxBatch) {
    throw Object.assign(new Error(`Selection of ${ids.length} exceeds the maximum batch size of ${maxBatch}.`), { status: 400 });
  }
  return ids;
}
