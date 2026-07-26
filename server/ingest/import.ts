/**
 * Single-file, two-sheet IKC import runner.
 *
 * Flow: computeIngestPlan() diffs a parsed workbook against the catalog (see
 * diff.ts) and returns an apply-plan; buildPreview() turns that plan into the
 * review payload the steward sees; applyIngestPlan() commits it in one
 * transaction, writing ONLY new rows and the specific changed fields.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  assets,
  attributes,
  auditLog,
  ingestRuns,
  type Attribute,
  type IngestRun,
} from "@shared/models/schema";
import { autoMapColumns } from "@shared/lib/ikc-fields";
import { invalidateDistinctCache } from "../catalog/query";
import type { WorkbookSheets } from "./parse";
import {
  buildAssetOps,
  buildAttributeOps,
  type AssetOp,
  type AttributeOp,
  type DiffCounts,
  type FieldChange,
} from "./diff";

const CHUNK = 500;
const MAX_CHANGED_ITEMS = 200;
const MAX_CHANGES_PER_ITEM = 40;
const SAMPLE = 20;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------
export interface IngestPlan {
  filename: string;
  sheetNames: string[];
  assetOps: AssetOp[];
  attributeOps: AttributeOp[];
  assetCounts: DiffCounts;
  attributeCounts: DiffCounts;
  skipped: number;
  warnings: string[];
}

export async function computeIngestPlan(
  sheets: WorkbookSheets,
  filename: string,
): Promise<IngestPlan> {
  const warnings: string[] = [];
  let skipped = 0;

  const existingAssets = await db.select().from(assets);

  let assetOps: AssetOp[] = [];
  let assetCounts: DiffCounts = { new: 0, changed: 0, unchanged: 0 };
  if (sheets.assetSheet && sheets.assetSheet.rows.length) {
    const mapping = autoMapColumns(sheets.assetSheet.headers, "asset");
    const r = buildAssetOps(sheets.assetSheet.rows, mapping, existingAssets);
    assetOps = r.ops;
    assetCounts = r.counts;
    skipped += r.skipped;
  } else {
    warnings.push('No "Asset" sheet was found in the workbook — no assets imported.');
  }

  // Map existing attributes by parent Asset Id + Column Name for matching.
  const ikcById = new Map(existingAssets.map((a) => [a.id, a.ikcAssetId]));
  const existingAttrByKey = new Map<string, Attribute>();
  const existingAttrs = await db.select().from(attributes);
  for (const at of existingAttrs) {
    const ikc = ikcById.get(at.assetId);
    if (ikc) existingAttrByKey.set(`${ikc}::${at.columnName}`, at);
  }

  let attributeOps: AttributeOp[] = [];
  let attributeCounts: DiffCounts = { new: 0, changed: 0, unchanged: 0 };
  if (sheets.columnSheet && sheets.columnSheet.rows.length) {
    const mapping = autoMapColumns(sheets.columnSheet.headers, "attribute");
    const r = buildAttributeOps(sheets.columnSheet.rows, mapping, existingAttrByKey);
    attributeOps = r.ops;
    attributeCounts = r.counts;
    skipped += r.skipped;
  } else {
    warnings.push('No "Columns" sheet was found in the workbook — no attributes imported.');
  }

  return {
    filename,
    sheetNames: sheets.sheetNames,
    assetOps,
    attributeOps,
    assetCounts,
    attributeCounts,
    skipped,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Preview (capped payload for the review screen)
// ---------------------------------------------------------------------------
export interface PreviewItem {
  kind: "asset" | "attribute";
  name: string;
  changes: FieldChange[];
  moreChanges: number;
}

export interface IngestPreview {
  filename: string;
  sheetNames: string[];
  assets: DiffCounts;
  attributes: DiffCounts;
  skipped: number;
  warnings: string[];
  hasChanges: boolean;
  changedItems: PreviewItem[];
  changedItemsTruncated: number;
  newAssetSample: string[];
  newAttributeSample: string[];
}

export function buildPreview(plan: IngestPlan): IngestPreview {
  const changedAssets = plan.assetOps.filter((o) => o.status === "changed");
  const changedAttrs = plan.attributeOps.filter((o) => o.status === "changed");

  const changedItems: PreviewItem[] = [];
  for (const op of changedAssets) {
    if (changedItems.length >= MAX_CHANGED_ITEMS) break;
    changedItems.push({
      kind: "asset",
      name: op.name,
      changes: op.changes.slice(0, MAX_CHANGES_PER_ITEM),
      moreChanges: Math.max(0, op.changes.length - MAX_CHANGES_PER_ITEM),
    });
  }
  for (const op of changedAttrs) {
    if (changedItems.length >= MAX_CHANGED_ITEMS) break;
    changedItems.push({
      kind: "attribute",
      name: `${op.assetName} · ${op.columnName}`,
      changes: op.changes.slice(0, MAX_CHANGES_PER_ITEM),
      moreChanges: Math.max(0, op.changes.length - MAX_CHANGES_PER_ITEM),
    });
  }

  const totalChanged = changedAssets.length + changedAttrs.length;
  const hasChanges =
    plan.assetCounts.new + plan.assetCounts.changed + plan.attributeCounts.new + plan.attributeCounts.changed > 0;

  return {
    filename: plan.filename,
    sheetNames: plan.sheetNames,
    assets: plan.assetCounts,
    attributes: plan.attributeCounts,
    skipped: plan.skipped,
    warnings: plan.warnings,
    hasChanges,
    changedItems,
    changedItemsTruncated: Math.max(0, totalChanged - changedItems.length),
    newAssetSample: plan.assetOps.filter((o) => o.status === "new").slice(0, SAMPLE).map((o) => o.name),
    newAttributeSample: plan.attributeOps
      .filter((o) => o.status === "new")
      .slice(0, SAMPLE)
      .map((o) => `${o.assetName} · ${o.columnName}`),
  };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------
export interface ApplySummary {
  runId: number;
  assetsCreated: number;
  assetsUpdated: number;
  attributesCreated: number;
  attributesUpdated: number;
  unchanged: number;
  skipped: number;
}

export async function applyIngestPlan(
  plan: IngestPlan,
  actorId: number | null,
): Promise<ApplySummary> {
  const totalRows = plan.assetOps.length + plan.attributeOps.length;
  const [run] = await db
    .insert(ingestRuns)
    .values({ filename: plan.filename, sheetType: "asset", rowCount: totalRows, status: "importing" })
    .returning();

  const summary: ApplySummary = {
    runId: run.id,
    assetsCreated: 0,
    assetsUpdated: 0,
    attributesCreated: 0,
    attributesUpdated: 0,
    unchanged: 0,
    skipped: plan.skipped,
  };

  try {
    await db.transaction(async (tx) => {
      const idByIkc = new Map<string, number>();

      // 1. Update changed assets (only the differing fields, plus a fresh raw snapshot).
      for (const op of plan.assetOps) {
        if (op.status === "changed" && op.existingId) {
          await tx
            .update(assets)
            .set({ ...op.values, rawRow: op.rawRow, ingestRunId: run.id } as Partial<typeof assets.$inferInsert>)
            .where(eq(assets.id, op.existingId));
          idByIkc.set(op.ikcAssetId, op.existingId);
          summary.assetsUpdated++;
        } else if (op.existingId) {
          idByIkc.set(op.ikcAssetId, op.existingId);
          summary.unchanged++;
        }
      }

      // 2. Insert new assets (batched) and capture their new ids.
      for (const group of chunk(plan.assetOps.filter((o) => o.status === "new"), CHUNK)) {
        const rows = group.map((o) => ({ ...o.values, rawRow: o.rawRow, ingestRunId: run.id }));
        const inserted = await tx
          .insert(assets)
          .values(rows as (typeof assets.$inferInsert)[])
          .returning({ id: assets.id, ikcAssetId: assets.ikcAssetId });
        for (const r of inserted) idByIkc.set(r.ikcAssetId, r.id);
        summary.assetsCreated += inserted.length;
      }

      // 3. Resolve parent ids for every attribute (DB lookup, then stub-create).
      const neededParents = new Set(plan.attributeOps.map((o) => o.ikcAssetId));
      const missing = [...neededParents].filter((p) => !idByIkc.has(p));
      for (const group of chunk(missing, CHUNK)) {
        const found = await tx
          .select({ id: assets.id, ikcAssetId: assets.ikcAssetId })
          .from(assets)
          .where(inArray(assets.ikcAssetId, group));
        for (const f of found) idByIkc.set(f.ikcAssetId, f.id);
      }
      const stillMissing = [...neededParents].filter((p) => !idByIkc.has(p));
      for (const group of chunk(stillMissing, CHUNK)) {
        const stubs = group.map((ikc) => {
          const src = plan.attributeOps.find((o) => o.ikcAssetId === ikc);
          return { ikcAssetId: ikc, name: src?.assetName || ikc, ingestRunId: run.id };
        });
        const inserted = await tx
          .insert(assets)
          .values(stubs)
          .returning({ id: assets.id, ikcAssetId: assets.ikcAssetId });
        for (const r of inserted) idByIkc.set(r.ikcAssetId, r.id);
        summary.assetsCreated += inserted.length;
      }

      // 4. Update changed attributes (only differing fields).
      for (const op of plan.attributeOps) {
        if (op.status === "changed" && op.existingId) {
          await tx
            .update(attributes)
            .set({ ...op.values, rawRow: op.rawRow, ingestRunId: run.id } as Partial<typeof attributes.$inferInsert>)
            .where(eq(attributes.id, op.existingId));
          summary.attributesUpdated++;
        } else if (op.status === "unchanged") {
          summary.unchanged++;
        }
      }

      // 5. Insert new attributes (batched) under their resolved parent asset.
      for (const group of chunk(plan.attributeOps.filter((o) => o.status === "new"), CHUNK)) {
        const rows = group
          .map((o) => {
            const assetId = idByIkc.get(o.ikcAssetId);
            if (assetId == null) return null;
            return { ...o.values, assetId, columnName: o.columnName, rawRow: o.rawRow, ingestRunId: run.id };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);
        if (rows.length) {
          await tx.insert(attributes).values(rows as (typeof attributes.$inferInsert)[]);
          summary.attributesCreated += rows.length;
        }
        summary.skipped += group.length - rows.length;
      }
    });

    await db
      .update(ingestRuns)
      .set({ status: "completed", finishedAt: new Date() })
      .where(eq(ingestRuns.id, run.id));
    // Distinct filter-option lists (domains, storage, …) may have changed.
    invalidateDistinctCache();
  } catch (err) {
    await db
      .update(ingestRuns)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(ingestRuns.id, run.id));
    throw err;
  }

  // Best-effort audit trail of the applied import.
  try {
    await db.insert(auditLog).values({
      actorId: actorId ?? undefined,
      action: "ingest_apply",
      entityType: "ingest_run",
      entityId: String(run.id),
      after: { filename: plan.filename, ...summary } as Record<string, unknown>,
      source: "import",
      runId: run.id,
    });
  } catch {
    /* audit is non-critical */
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Read helpers (import-run history)
// ---------------------------------------------------------------------------
export async function listIngestRuns(): Promise<IngestRun[]> {
  return db.select().from(ingestRuns).orderBy(sql`${ingestRuns.startedAt} DESC`).limit(50);
}

export async function getIngestRun(id: number): Promise<IngestRun | undefined> {
  const [row] = await db.select().from(ingestRuns).where(eq(ingestRuns.id, id)).limit(1);
  return row;
}
