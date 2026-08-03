/**
 * Export to .xlsx (Prompt 2 §8). One sheet per scope, frozen header + autofilter,
 * hidden _row_key + _export_batch_id, locked read-only columns and unlocked decision
 * columns with data-validation dropdowns, plus a README sheet. Records export_batches
 * so the round-trip re-import can be validated.
 */
import ExcelJS from "exceljs";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  assets,
  attributes,
  classifications,
  criterionAssessments,
  detections,
  exportBatches,
  ingestRuns,
  runItems,
} from "@shared/models/schema";
import { CRITERION_CODES } from "@shared/lib/criteria";
import { CLASSIFICATION_CODES } from "@shared/lib/classification";
import { resolveAssetIds, resolveAttributeIds } from "../catalog/query";
import { getActiveFrameworkVersion } from "../frameworks/store";
import { EXPORT_COLUMNS, columnByKey, rowKey } from "./columns";
import { formatDateTime } from "./util";

export interface ExportScope {
  kind: "selection" | "filter" | "all";
  ids?: number[];
  filters?: Record<string, unknown>;
}

export interface ExportRequest {
  screen: "assets" | "attributes";
  scope: ExportScope;
  columns: string[];
  filename?: string;
}

export type ExportRow = Record<string, string | number> & { _row_key: string };

/**
 * Resolve an export scope to ATTRIBUTE ids (rows are always attribute-level). For
 * asset scope, the resolved asset ids are expanded to their attributes.
 */
async function resolveIds(screen: "assets" | "attributes", scope: ExportScope): Promise<number[]> {
  if (screen === "attributes") {
    if (scope.kind === "selection" && scope.ids) return scope.ids;
    return resolveAttributeIds(scope.filters ?? {});
  }
  const assetIds = scope.kind === "selection" && scope.ids ? scope.ids : await resolveAssetIds(scope.filters ?? {});
  if (assetIds.length === 0) return [];
  const rows = await db.select({ id: attributes.id }).from(attributes).where(inArray(attributes.assetId, assetIds));
  return rows.map((r) => r.id);
}

export async function buildAttributeExportRows(ids: number[]): Promise<ExportRow[]> {
  if (ids.length === 0) return [];
  const attrs = await db.select().from(attributes).where(inArray(attributes.id, ids));
  const assetIds = [...new Set(attrs.map((a) => a.assetId))];
  const assetRows = assetIds.length ? await db.select().from(assets).where(inArray(assets.id, assetIds)) : [];
  const assetMap = new Map(assetRows.map((a) => [a.id, a]));

  const items = await db.select().from(runItems).where(inArray(runItems.targetId, ids));
  const latestItem = new Map<number, (typeof items)[number]>();
  for (const it of items) {
    const prev = latestItem.get(it.targetId);
    if (!prev || it.id > prev.id) latestItem.set(it.targetId, it);
  }
  const latestIds = [...latestItem.values()].map((i) => i.id);
  const assessments = latestIds.length ? await db.select().from(criterionAssessments).where(inArray(criterionAssessments.runItemId, latestIds)) : [];
  const assessByItem = new Map<number, typeof assessments>();
  for (const a of assessments) {
    const list = assessByItem.get(a.runItemId) ?? [];
    list.push(a);
    assessByItem.set(a.runItemId, list);
  }

  // Active attribute classifications (findings/reasoning) + latest detection (audit).
  const classRows = await db
    .select()
    .from(classifications)
    .where(and(eq(classifications.scope, "attribute"), isNull(classifications.supersededBy), inArray(classifications.targetId, ids)));
  const classByAttr = new Map(classRows.map((c) => [c.targetId, c]));
  const detRows = await db.select().from(detections).where(inArray(detections.attributeId, ids));
  const latestDet = new Map<number, (typeof detRows)[number]>();
  for (const d of detRows) {
    const prev = latestDet.get(d.attributeId);
    if (!prev || d.id > prev.id) latestDet.set(d.attributeId, d);
  }

  // Source import per column. Without it an export that mixes two IKC loads is
  // indistinguishable — the catalogs share table-name prefixes and some names.
  const ingestRunIds = [...new Set(attrs.map((a) => a.ingestRunId).filter((x): x is number => x != null))];
  const ingestRows = ingestRunIds.length
    ? await db.select().from(ingestRuns).where(inArray(ingestRuns.id, ingestRunIds))
    : [];
  const ingestLabel = new Map(
    ingestRows.map((r) => [r.id, `${r.filename} · ${r.startedAt.toISOString().slice(0, 10)}`]),
  );

  return attrs.map((attr) => {
    const asset = assetMap.get(attr.assetId);
    const item = latestItem.get(attr.id);
    const cls = classByAttr.get(attr.id);
    const det = latestDet.get(attr.id);
    const itemAssessments = item ? assessByItem.get(item.id) ?? [] : [];
    const applied = itemAssessments.filter((a) => a.applies).map((a) => a.criterionCode);

    const row: ExportRow = {
      _row_key: rowKey(asset?.ikcAssetId ?? attr.assetId, attr.columnName),
      ikcAssetId: asset?.ikcAssetId ?? "",
      assetName: asset?.name ?? "",
      columnName: attr.columnName,
      importBatch: attr.ingestRunId != null ? ingestLabel.get(attr.ingestRunId) ?? String(attr.ingestRunId) : "",
      catalogId: asset?.catalogId ?? "",
      businessDomain: (asset?.businessDomain ?? []).join("; "),
      subjectArea: (asset?.subjectArea ?? []).join("; "),
      department: (asset?.department ?? []).join("; "),
      sector: (asset?.sector ?? []).join("; "),
      owner: asset?.ownerId ?? "",
      stewards: (asset?.stewards ?? []).join("; "),
      dataType: attr.dataType ?? "",
      nativeType: attr.nativeType ?? "",
      length: attr.length ?? "",
      scale: attr.scale ?? "",
      nullable: attr.nullable ? "Yes" : "No",
      signed: attr.signed == null ? "" : attr.signed ? "Yes" : "No",
      isPrimaryKey: attr.isPrimaryKey ? "Yes" : "No",
      qualityScore: attr.qualityScore ?? "",
      selectedDataClassName: attr.selectedDataClassName ?? "",
      selectedDataClassConfidence: attr.selectedDataClassConfidence ?? "",
      suggestedClasses: (attr.suggestedClasses ?? []).join(", "),
      columnDataClassification: attr.columnDataClassification ?? "",
      retentionPeriod: asset?.retentionPeriod ?? "",
      storage: asset?.storage ?? "",
      cdeFlag: attr.cdeFlag ? "Yes" : "No",
      cdeDescription: "",
      piiName: attr.piiName ?? "",
      piiDescription: attr.piiDescription ?? "",
      verdict: item?.verdict ?? "not_analysed",
      criteriaMatched: applied.join(", "),
      confidence: item ? Number(item.confidence.toFixed(2)) : 0,
      sourceLayer: (item?.sourceLayers ?? []).join(", "),
      overallRationaleEn: item?.rationaleEn ?? "",
      overallRationaleAr: item?.rationaleAr ?? "",
      classLevel: cls?.levelCode ?? "",
      classSource: cls?.derivedFrom ?? "",
      classRationaleEn: cls?.rationale ?? "",
      classRationaleAr: "",
      runId: det?.runId ?? "",
      modelId: det?.modelId ?? "",
      frameworkVersion: det?.frameworkVersion ?? "",
      analysedAt: det ? new Date(det.createdAt).toISOString().slice(0, 10) : "",
      pii_decision: item?.verdict === "pii" ? "Yes" : item?.verdict === "not_pii" ? "No" : "Uncertain",
      classification_decision: attr.columnDataClassification ?? "",
    };
    for (const code of CRITERION_CODES) {
      const a = itemAssessments.find((x) => x.criterionCode === code);
      row[`crit_${code}_applies`] = a ? (a.applies ? "Yes" : "No") : "";
      row[`crit_${code}_reason`] = a?.rationaleEn ?? "";
      row[`crit_${code}_reason_ar`] = a?.rationaleAr ?? "";
    }
    return row;
  });
}

export async function generateWorkbook(
  rows: ExportRow[],
  columnKeys: string[],
  batchId: number,
  meta: { filters?: unknown; exportedBy: string; frameworkVersion?: string },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Attributes");

  const selected = columnKeys.map(columnByKey).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const columns = [
    ...selected.map((c) => ({ header: c.header, key: c.key, width: 22 })),
    { header: "_row_key", key: "_row_key", width: 12 },
    { header: "_export_batch_id", key: "_export_batch_id", width: 12 },
  ];
  sheet.columns = columns;

  for (const row of rows) {
    sheet.addRow({ ...row, _export_batch_id: batchId });
  }

  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const lastColLetter = sheet.getColumn(columns.length).letter;
  sheet.autoFilter = { from: "A1", to: `${lastColLetter}1` };
  sheet.getColumn("_row_key").hidden = true;
  sheet.getColumn("_export_batch_id").hidden = true;

  // RTL alignment on Arabic columns.
  for (const c of selected.filter((x) => x.rtl)) {
    sheet.getColumn(c.key).alignment = { readingOrder: "rtl", horizontal: "right" };
  }

  // Data-validation dropdowns on the two decision columns. The sheet is intentionally NOT
  // protected — it stays fully filterable/sortable/editable. Re-import already ignores changes
  // to read-only columns server-side, so no Excel-level lock is needed.
  const editableKeys = new Set(selected.filter((c) => c.editable).map((c) => c.key));
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    for (const key of editableKeys) {
      const cell = row.getCell(key);
      if (key === "pii_decision") {
        cell.dataValidation = { type: "list", allowBlank: true, formulae: ['"Yes,No,Uncertain"'] };
      } else if (key === "classification_decision") {
        cell.dataValidation = { type: "list", allowBlank: true, formulae: [`"${CLASSIFICATION_CODES.join(",")}"`] };
      }
    }
  });

  // Assets sheet — one row per distinct asset in the exported set.
  const assetSheet = wb.addWorksheet("Assets");
  assetSheet.columns = [
    { header: "Asset Id", key: "ikcAssetId", width: 24 },
    { header: "Asset Name", key: "assetName", width: 28 },
    { header: "Business Domain", key: "businessDomain", width: 22 },
    { header: "Columns", key: "columns", width: 10 },
    { header: "Contains PII", key: "pii", width: 12 },
  ];
  const byAsset = new Map<string, { ikcAssetId: string; assetName: string; businessDomain: string; columns: number; pii: boolean }>();
  for (const r of rows) {
    const key = String(r.ikcAssetId);
    const entry = byAsset.get(key) ?? { ikcAssetId: key, assetName: String(r.assetName ?? ""), businessDomain: String(r.businessDomain ?? ""), columns: 0, pii: false };
    entry.columns++;
    if (r.verdict === "pii") entry.pii = true;
    byAsset.set(key, entry);
  }
  for (const a of byAsset.values()) assetSheet.addRow({ ...a, pii: a.pii ? "Yes" : "No" });
  assetSheet.getRow(1).font = { bold: true };
  assetSheet.views = [{ state: "frozen", ySplit: 1 }];

  // README sheet.
  const readme = wb.addWorksheet("README");
  readme.columns = [{ width: 24 }, { width: 80 }];
  const readmeRows: [string, string][] = [
    ["PDTC Export", "Personal Data Tagging & Classification Workbench"],
    ["Export batch id", String(batchId)],
    ["Rows", String(rows.length)],
    ["Columns", columnKeys.join(", ")],
    ["Filters", JSON.stringify(meta.filters ?? {})],
    ["Framework version", meta.frameworkVersion ?? "—"],
    ["Exported by", meta.exportedBy],
    ["Generated", formatDateTime(new Date())],
    ["Editable columns", "PII Decision (Yes/No/Uncertain), Classification Decision (ISMS level)"],
    ["Re-upload", "Upload this file on the Import page. Only the editable columns are applied; changes to read-only columns are reported and ignored."],
  ];
  readmeRows.forEach((r) => readme.addRow(r));
  readme.getColumn(1).font = { bold: true };

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export async function createExport(
  input: ExportRequest,
  createdBy: number | null,
  exportedByName: string,
): Promise<{ batchId: number; filename: string; rowCount: number }> {
  const ids = await resolveIds(input.screen, input.scope);
  const rows = await buildAttributeExportRows(ids);
  const filename = input.filename ?? `pdtc-${input.screen}-${ids.length}.xlsx`;

  const [batch] = await db
    .insert(exportBatches)
    .values({
      // Persist the screen alongside the scope so download can re-resolve correctly.
      scope: { ...input.scope, screen: input.screen } as unknown as Record<string, unknown>,
      filters: (input.scope.filters ?? {}) as Record<string, unknown>,
      columns: input.columns,
      rowKeys: rows.map((r) => r._row_key),
      filename,
      rowCount: rows.length,
      createdBy: createdBy ?? undefined,
    })
    .returning();

  // Cache the generated buffer for immediate download.
  const fw = await getActiveFrameworkVersion("pii");
  const buffer = await generateWorkbook(rows, input.columns, batch.id, { filters: input.scope.filters, exportedBy: exportedByName, frameworkVersion: fw.version });
  exportBufferCache.set(batch.id, buffer);
  return { batchId: batch.id, filename, rowCount: rows.length };
}

// Short-lived in-memory buffer cache; download regenerates if missing.
const exportBufferCache = new Map<number, Buffer>();

export async function downloadExport(batchId: number): Promise<{ buffer: Buffer; filename: string } | null> {
  const [batch] = await db.select().from(exportBatches).where(inArray(exportBatches.id, [batchId])).limit(1);
  if (!batch) return null;
  let buffer = exportBufferCache.get(batchId);
  if (!buffer) {
    const scope = batch.scope as unknown as ExportScope & { screen?: "assets" | "attributes" };
    const ids = await resolveIds(scope.screen ?? "attributes", scope);
    const rows = await buildAttributeExportRows(ids);
    buffer = await generateWorkbook(rows, batch.columns ?? EXPORT_COLUMNS.map((c) => c.key), batchId, { filters: batch.filters, exportedBy: "steward" });
  }
  return { buffer, filename: batch.filename };
}
