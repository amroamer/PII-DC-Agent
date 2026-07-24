/**
 * Re-import with diff review (Prompt 2 §9). Matches rows on _row_key (falling back
 * to Asset Id + Column Name), diffs ONLY the editable columns, reports read-only
 * changes as warnings and ignores them on commit, and applies accepted changes in a
 * single transaction — never deleting the AI's original finding.
 */
import ExcelJS from "exceljs";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  assets,
  attributes,
  auditLog,
  classifications,
  exportBatches,
  importBatches,
  importDiffs,
} from "@shared/models/schema";
import { rollupLevel, isClassificationCode, type ClassificationCode } from "@shared/lib/classification";
import { columnByKey, rowKey } from "./columns";

interface SheetRow {
  values: Record<string, unknown>;
}

function parseWorkbook(buffer: Buffer): Promise<{ headers: string[]; rows: SheetRow[] }> {
  const wb = new ExcelJS.Workbook();
  return wb.xlsx.load(buffer as unknown as ArrayBuffer).then(() => {
    const sheet = wb.getWorksheet("Attributes") ?? wb.worksheets[0];
    const headers: string[] = [];
    if (!sheet) return { headers, rows: [] };
    sheet.getRow(1).eachCell((cell, col) => {
      headers[col] = String(cell.value ?? "");
    });
    const rows: SheetRow[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values: Record<string, unknown> = {};
      row.eachCell((cell, col) => {
        values[headers[col]] = cell.value;
      });
      rows.push({ values });
    });
    return { headers, rows };
  });
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v && "text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>).text);
  return String(v).trim();
}

export interface ImportSummary {
  matched: number;
  unmatched: number;
  deletedRows: number;
  piiChanges: number;
  classificationChanges: number;
  clearedFields: number;
  readOnlyWarnings: number;
  columnsAdded: string[];
  columnsRemoved: string[];
}

export interface CurrentCatalogRow {
  piiName: string | null;
  columnDataClassification: string | null;
  columnName: string;
  dataType: string | null;
  selectedDataClassName: string | null;
}

export interface RowDiff {
  field: string;
  currentValue: string;
  incomingValue: string;
  changeType: string;
}

const READONLY_HEADERS: Array<{ header: string; get: (c: CurrentCatalogRow) => string }> = [
  { header: "Column Name", get: (c) => c.columnName },
  { header: "Data Type", get: (c) => c.dataType ?? "" },
  { header: "Selected Class", get: (c) => c.selectedDataClassName ?? "" },
  { header: "PII Name", get: (c) => c.piiName ?? "" },
];

/**
 * Pure diff of ONE imported row against the current catalog. Only the two editable
 * columns produce diffs; a change to any read-only column is counted as a warning
 * and never written. Unit-tested (round-trip + read-only enforcement).
 */
export function computeRowDiffs(
  values: Record<string, unknown>,
  current: CurrentCatalogRow,
): { diffs: RowDiff[]; readOnlyWarnings: number } {
  const diffs: RowDiff[] = [];

  if ("PII Decision" in values) {
    const incoming = str(values["PII Decision"]);
    const currentDecision = current.piiName ? "Yes" : "No";
    if (incoming === "") {
      // A blanked cell that previously carried a positive tag is a "field cleared".
      if (current.piiName) {
        diffs.push({ field: "pii_decision", currentValue: currentDecision, incomingValue: "", changeType: "cleared" });
      }
    } else if (incoming !== currentDecision) {
      diffs.push({ field: "pii_decision", currentValue: currentDecision, incomingValue: incoming, changeType: "pii_verdict" });
    }
  }
  if ("Classification Decision" in values) {
    const incoming = str(values["Classification Decision"]).toUpperCase();
    const currentLevel = current.columnDataClassification ?? "";
    if (incoming === "" && currentLevel) {
      diffs.push({ field: "classification_decision", currentValue: currentLevel, incomingValue: "", changeType: "cleared" });
    } else if (incoming && incoming !== currentLevel && isClassificationCode(incoming)) {
      diffs.push({ field: "classification_decision", currentValue: currentLevel || "Unclassified", incomingValue: incoming, changeType: "classification" });
    }
  }

  let readOnlyWarnings = 0;
  for (const ro of READONLY_HEADERS) {
    if (ro.header in values) {
      const incoming = str(values[ro.header]);
      if (incoming && incoming !== ro.get(current)) readOnlyWarnings++;
    }
  }

  return { diffs, readOnlyWarnings };
}

export async function createImport(
  buffer: Buffer,
  filename: string,
  createdBy: number | null,
): Promise<{ batchId: number; summary: ImportSummary }> {
  const { headers, rows } = await parseWorkbook(buffer);

  const exportBatchId = rows.length ? Number(str(rows[0].values["_export_batch_id"])) : NaN;
  let matchMode: "batch" | "keys" = "keys";
  let exportBatch: typeof exportBatches.$inferSelect | undefined;
  if (!Number.isNaN(exportBatchId)) {
    [exportBatch] = await db.select().from(exportBatches).where(eq(exportBatches.id, exportBatchId)).limit(1);
    if (exportBatch) matchMode = "batch";
  }

  // Catalog match maps: primary by _row_key, fallback by (Asset Id, Column Name).
  const attrRows = await db.select().from(attributes);
  const assetRows = await db.select().from(assets);
  const assetMap = new Map(assetRows.map((a) => [a.id, a]));
  const byRowKey = new Map<string, (typeof attrRows)[number]>();
  const byAssetColumn = new Map<string, (typeof attrRows)[number]>();
  for (const attr of attrRows) {
    const idPart = assetMap.get(attr.assetId)?.ikcAssetId ?? attr.assetId;
    byRowKey.set(rowKey(idPart, attr.columnName), attr);
    byAssetColumn.set(`${idPart}::${attr.columnName}`, attr);
  }

  // Column-set validation against the recorded export columns.
  const sheetHeaders = headers.filter((h) => h && h !== "_row_key" && h !== "_export_batch_id");
  let columnsAdded: string[] = [];
  let columnsRemoved: string[] = [];
  if (exportBatch) {
    const expected = (exportBatch.columns ?? [])
      .map((k) => columnByKey(k)?.header)
      .filter((h): h is string => Boolean(h));
    columnsAdded = sheetHeaders.filter((h) => !expected.includes(h));
    columnsRemoved = expected.filter((h) => !sheetHeaders.includes(h));
  }

  const [batch] = await db
    .insert(importBatches)
    .values({
      exportBatchId: Number.isNaN(exportBatchId) ? undefined : exportBatchId,
      filename,
      status: "validating",
      matchMode,
      createdBy: createdBy ?? undefined,
    })
    .returning();

  const summary: ImportSummary = {
    matched: 0,
    unmatched: 0,
    deletedRows: 0,
    piiChanges: 0,
    classificationChanges: 0,
    clearedFields: 0,
    readOnlyWarnings: 0,
    columnsAdded,
    columnsRemoved,
  };
  const diffInserts: Array<typeof importDiffs.$inferInsert> = [];
  const seenKeys = new Set<string>();

  for (const row of rows) {
    let rk = str(row.values["_row_key"]);
    let attr = rk ? byRowKey.get(rk) : undefined;
    if (!attr) {
      const aid = str(row.values["Asset Id"]);
      const col = str(row.values["Column Name"]);
      if (aid && col) {
        attr = byAssetColumn.get(`${aid}::${col}`);
        if (attr) rk = rowKey(aid, col);
      }
    }
    if (!attr) {
      summary.unmatched++;
      continue;
    }
    seenKeys.add(rk || rowKey(assetMap.get(attr.assetId)?.ikcAssetId ?? attr.assetId, attr.columnName));
    summary.matched++;

    const { diffs, readOnlyWarnings } = computeRowDiffs(row.values, {
      piiName: attr.piiName,
      columnDataClassification: attr.columnDataClassification,
      columnName: attr.columnName,
      dataType: attr.dataType,
      selectedDataClassName: attr.selectedDataClassName,
    });
    summary.readOnlyWarnings += readOnlyWarnings;

    for (const d of diffs) {
      if (d.changeType === "cleared") summary.clearedFields++;
      else if (d.field === "pii_decision") summary.piiChanges++;
      else if (d.field === "classification_decision") summary.classificationChanges++;
      diffInserts.push({
        importBatchId: batch.id,
        targetType: "attribute",
        targetId: attr.id,
        field: d.field,
        currentValue: d.currentValue,
        incomingValue: d.incomingValue,
        changeType: d.changeType as (typeof importDiffs.$inferInsert)["changeType"],
        status: "pending",
      });
    }
  }

  // Rows in the original export that are absent from the uploaded sheet = deletions.
  if (exportBatch?.rowKeys?.length) {
    summary.deletedRows = exportBatch.rowKeys.filter((k) => !seenKeys.has(k)).length;
  }

  if (diffInserts.length) await db.insert(importDiffs).values(diffInserts);
  await db
    .update(importBatches)
    .set({ status: "ready", summary: summary as unknown as Record<string, unknown> })
    .where(eq(importBatches.id, batch.id));

  return { batchId: batch.id, summary };
}

export async function listDiffs(
  batchId: number,
  opts: { changeType?: string; page?: number; pageSize?: number } = {},
) {
  const conds = [eq(importDiffs.importBatchId, batchId)];
  if (opts.changeType) conds.push(eq(importDiffs.changeType, opts.changeType as (typeof importDiffs.$inferSelect)["changeType"]));
  const pageSize = Math.min(Math.max(opts.pageSize ?? 100, 1), 500);
  const page = Math.max(opts.page ?? 1, 1);
  return db
    .select()
    .from(importDiffs)
    .where(and(...conds))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

export async function setDiffDecisions(diffIds: number[], status: "accepted" | "rejected"): Promise<number> {
  if (diffIds.length === 0) return 0;
  await db.update(importDiffs).set({ status }).where(inArray(importDiffs.id, diffIds));
  return diffIds.length;
}

export async function resolveDiffIds(
  batchId: number,
  selection: { mode: string; ids?: number[]; excluded?: number[] },
): Promise<number[]> {
  if (selection.mode === "none") return [];
  if (selection.mode === "include") return selection.ids ?? [];
  const rows = await db.select({ id: importDiffs.id }).from(importDiffs).where(eq(importDiffs.importBatchId, batchId));
  const excluded = new Set(selection.excluded ?? []);
  return rows.map((r) => r.id).filter((id) => !excluded.has(id));
}

export async function approveImport(
  batchId: number,
  justification: string,
  actorId: number | null,
): Promise<{ applied: number; assetsRolledUp: number }> {
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1);
  if (!batch) throw Object.assign(new Error("Import batch not found."), { status: 404 });

  let applied = 0;
  const affectedAssets = new Set<number>();

  await db.transaction(async (tx) => {
    const accepted = await tx.select().from(importDiffs).where(and(eq(importDiffs.importBatchId, batchId), eq(importDiffs.status, "accepted")));

    for (const diff of accepted) {
      const [attr] = await tx.select().from(attributes).where(eq(attributes.id, diff.targetId)).limit(1);
      if (!attr) continue;
      affectedAssets.add(attr.assetId);

      if (diff.field === "classification_decision") {
        const cleared = diff.changeType === "cleared" || !isClassificationCode(diff.incomingValue ?? "");
        const level = cleared ? null : (diff.incomingValue as ClassificationCode);
        const [active] = await tx
          .select()
          .from(classifications)
          .where(and(eq(classifications.scope, "attribute"), eq(classifications.targetId, attr.id), isNull(classifications.supersededBy)))
          .limit(1);
        if (level) {
          const [inserted] = await tx
            .insert(classifications)
            .values({ scope: "attribute", targetId: attr.id, levelCode: level, derivedFrom: "override", rationale: `Imported steward decision (batch ${batchId}).` })
            .returning();
          // Never delete the AI's original — mark it superseded + overridden-by-import.
          if (active) {
            await tx.update(classifications).set({ supersededBy: inserted.id, overriddenByImport: batchId }).where(eq(classifications.id, active.id));
          }
        } else if (active) {
          // Cleared: retire the active classification (still never deleted).
          await tx.update(classifications).set({ supersededBy: active.id, overriddenByImport: batchId }).where(eq(classifications.id, active.id));
        }
        await tx.update(attributes).set({ columnDataClassification: level }).where(eq(attributes.id, attr.id));
      } else if (diff.field === "pii_decision") {
        // BUG-5 fix: derive the write from the incoming decision, treating a cleared/No as "not PII".
        const setPii = diff.changeType !== "cleared" && diff.incomingValue === "Yes";
        await tx.update(attributes).set({ piiName: setPii ? attr.piiName ?? "PII" : null }).where(eq(attributes.id, attr.id));
      }

      await tx.update(importDiffs).set({ status: "applied", appliedAt: new Date() }).where(eq(importDiffs.id, diff.id));
      await tx.insert(auditLog).values({
        actorId: actorId ?? undefined,
        action: "import_apply",
        entityType: "attribute",
        entityId: String(attr.id),
        before: { field: diff.field, value: diff.currentValue },
        after: { field: diff.field, value: diff.incomingValue },
        rationale: justification,
        source: "import",
        importBatchId: batchId,
      });
      applied++;
    }

    for (const assetId of affectedAssets) {
      const attrs = await tx.select().from(attributes).where(eq(attributes.assetId, assetId));
      const levels = attrs.map((a) => a.columnDataClassification).filter((l): l is ClassificationCode => !!l);
      const rolled = rollupLevel(levels);
      await tx.update(assets).set({ piiFlag: attrs.some((a) => Boolean(a.piiName)), ...(rolled ? { assetClassification: rolled } : {}) }).where(eq(assets.id, assetId));
    }

    await tx.update(importBatches).set({ status: "approved", justification, approvedBy: actorId ?? undefined, approvedAt: new Date() }).where(eq(importBatches.id, batchId));
  });

  return { applied, assetsRolledUp: affectedAssets.size };
}
