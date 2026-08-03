/**
 * "Original file + PII" export.
 *
 * Rebuilds the uploaded IKC workbook from the raw spreadsheet rows kept on every
 * asset and attribute at import, with the PII fields the engine decided written
 * INTO the original columns — `Pii Name`, `Pii Description` and `Column Data
 * Classification` are IKC's own headers, so the result is the customer's file
 * with its empty governance columns filled in, not a separate report.
 *
 * Sheet names ("Asset", "Columns") and header spellings match what the importer
 * accepts, so the output can go back into IKC or be re-ingested here.
 *
 * Caveat worth knowing: raw rows are stored as jsonb, and Postgres normalises
 * jsonb key order (by length, then bytewise) — the uploaded column ORDER cannot
 * be recovered. Columns are therefore emitted in canonical IKC field order, with
 * any unrecognised original headers kept afterwards so nothing is dropped. IKC
 * matches on header name rather than position, so this round-trips cleanly.
 */
import ExcelJS from "exceljs";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { assets, attributes, classifications, detections } from "@shared/models/schema";
import { IKC_ASSET_FIELDS, IKC_ATTRIBUTE_FIELDS, type IkcFieldDef } from "@shared/lib/ikc-fields";
import { displayPiiType } from "@shared/lib/detection-view";
import { mergeSignals, detectionToSignal } from "../pii-engine/merge";
import { getSetting } from "../reference-cache";

/** The IKC fields this export WRITES rather than echoes back, by internal key. */
const WRITTEN_KEYS = { piiName: "piiName", piiDescription: "piiDescription", classification: "columnDataClassification" } as const;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Raw spreadsheet header -> internal field key, via the canonical header AND its
 * aliases, case- and spacing-insensitively. Necessary because the canon says
 * "Asset ID" while real IKC exports say "Asset Id", and "PII" vs "Pii Name" —
 * matching exactly would treat almost every column as unrecognised.
 */
function headerToKey(fields: IkcFieldDef[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of fields) {
    m.set(norm(f.header), f.key);
    for (const a of f.aliases) m.set(norm(a), f.key);
  }
  return m;
}

/**
 * The header in THIS file that carries `key` — so the engine's findings land in
 * the customer's own column rather than a second one beside it. Falls back to the
 * canonical header when the source file has no such column.
 */
function targetHeader(raw: Row, fields: IkcFieldDef[], key: string): string {
  const keyOf = headerToKey(fields);
  for (const h of Object.keys(raw)) if (keyOf.get(norm(h)) === key) return h;
  return fields.find((f) => f.key === key)?.header ?? key;
}

/**
 * Appended to the right of the original columns. IKC ignores headers it does not
 * know, so these ride along for a human reviewer without breaking re-import.
 */
const AUDIT_HEADERS = [
  "PDTC Verdict",
  "PDTC Criteria Matched",
  "PDTC Confidence",
  "PDTC Rationale",
  "PDTC Source Import",
] as const;

type Row = Record<string, unknown>;

/**
 * Canonical order first, then any original header the canon does not name.
 *
 * Necessary because raw rows are jsonb and Postgres normalises jsonb key order,
 * so the uploaded column order is not recoverable. Unknown headers are kept
 * rather than dropped — a column PDTC does not model is still the customer's.
 */
export function orderHeaders(rawRows: Row[], fields: IkcFieldDef[]): string[] {
  const keyOf = headerToKey(fields);
  const rank = new Map(fields.map((f, i) => [f.key, i]));

  // Union of headers across rows — rows need not all carry the same columns.
  const present: string[] = [];
  const seen = new Set<string>();
  for (const r of rawRows) {
    for (const h of Object.keys(r)) {
      if (!seen.has(h)) {
        seen.add(h);
        present.push(h);
      }
    }
  }

  // Recognised headers in canonical order; unrecognised ones keep their relative
  // order and follow. Nothing is dropped — a column PDTC does not model is still
  // the customer's data.
  return present
    .map((h, i) => ({ h, i, r: rank.get(keyOf.get(norm(h)) ?? "") ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.h);
}

function cell(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.join("; ");
  return String(v);
}

export interface RoundTripResult {
  buffer: Buffer;
  attributeRows: number;
  assetRows: number;
  filled: number;
}

export async function buildRoundTripWorkbook(attributeIds: number[]): Promise<RoundTripResult> {
  const attrRows = attributeIds.length
    ? await db.select().from(attributes).where(inArray(attributes.id, attributeIds))
    : [];
  const assetIds = [...new Set(attrRows.map((a) => a.assetId))];
  const assetRows = assetIds.length ? await db.select().from(assets).where(inArray(assets.id, assetIds)) : [];

  // Fused verdict per attribute, from its OWN latest run — same rule the catalog
  // table uses, so the sheet and the screen never disagree.
  const threshold = getSetting<number>("confidence_review_threshold") ?? 0.6;
  const detRows = attributeIds.length
    ? await db.select().from(detections).where(inArray(detections.attributeId, attributeIds))
    : [];
  const latestRunOf = new Map<number, { runId: string; at: number }>();
  for (const d of detRows) {
    const at = d.createdAt instanceof Date ? d.createdAt.getTime() : 0;
    const best = latestRunOf.get(d.attributeId);
    if (!best || at > best.at) latestRunOf.set(d.attributeId, { runId: d.runId, at });
  }
  const byAttribute = new Map<number, typeof detRows>();
  for (const d of detRows) {
    if (d.runId !== latestRunOf.get(d.attributeId)?.runId) continue;
    const list = byAttribute.get(d.attributeId) ?? [];
    list.push(d);
    byAttribute.set(d.attributeId, list);
  }

  const clsRows = attributeIds.length
    ? await db
        .select()
        .from(classifications)
        .where(and(eq(classifications.scope, "attribute"), isNull(classifications.supersededBy), inArray(classifications.targetId, attributeIds)))
    : [];
  const clsByAttr = new Map(clsRows.map((c) => [c.targetId, c]));

  const wb = new ExcelJS.Workbook();
  let filled = 0;

  // --- Columns sheet ------------------------------------------------------
  const attrRaw = attrRows.map((a) => (a.rawRow ?? {}) as Row);
  const attrHeaders = orderHeaders(attrRaw, IKC_ATTRIBUTE_FIELDS);
  // Resolve the write targets ONCE from the file's own headers.
  const sample = attrRaw[0] ?? {};
  const hPiiName = targetHeader(sample, IKC_ATTRIBUTE_FIELDS, WRITTEN_KEYS.piiName);
  const hPiiDesc = targetHeader(sample, IKC_ATTRIBUTE_FIELDS, WRITTEN_KEYS.piiDescription);
  const hClass = targetHeader(sample, IKC_ATTRIBUTE_FIELDS, WRITTEN_KEYS.classification);
  for (const h of [hPiiName, hPiiDesc, hClass]) if (!attrHeaders.includes(h)) attrHeaders.push(h);
  const colSheet = wb.addWorksheet("Columns");
  colSheet.columns = [...attrHeaders, ...AUDIT_HEADERS].map((h) => ({ header: h, key: h, width: 24 }));

  for (const attr of attrRows) {
    const raw = { ...((attr.rawRow ?? {}) as Row) };
    const layers = byAttribute.get(attr.id);
    const merged = layers?.length ? mergeSignals(layers.map(detectionToSignal), threshold) : null;

    // Only write into the original columns where the engine actually decided —
    // an unanalysed column keeps whatever the source file had, rather than being
    // filled with a guess.
    if (merged) {
      filled++;
      if (merged.verdict === "pii") {
        // `Pii Name` is IKC's label for WHAT KIND of personal data this is, so it
        // must never receive a criterion code — the LLM layer routinely reports
        // the criterion as its data class, which would write "DIRECT_ID" into a
        // customer's catalog. displayDataClass strips those; the criterion is
        // carried precisely in the appended PDTC column instead.
        // displayPiiType also drops IKC's shape-only sentinels — "NoClassDetected"
        // covers most of this catalog, and "Text"/"Code" say nothing about what
        // the column holds. Better a plain "Personal Data" than a junk label
        // written back into the customer's catalog.
        raw[hPiiName] =
          displayPiiType({
            verdict: merged.verdict,
            piiName: attr.piiName,
            dataClassCode: merged.dataClassCode,
            criterion: merged.criterion,
            selectedDataClassName: attr.selectedDataClassName,
          }) ?? "Personal Data";
        raw[hPiiDesc] = merged.rationaleEn;
      }
      const level = clsByAttr.get(attr.id)?.levelCode ?? attr.columnDataClassification;
      if (level) raw[hClass] = level;
    }

    colSheet.addRow({
      ...Object.fromEntries(attrHeaders.map((h) => [h, cell(raw[h])])),
      "PDTC Verdict": merged?.verdict ?? "not_analysed",
      "PDTC Criteria Matched": merged?.criterion ?? "",
      "PDTC Confidence": merged ? Number(merged.confidence.toFixed(2)) : "",
      "PDTC Rationale": merged?.rationaleEn ?? "",
      "PDTC Source Import": attr.ingestRunId ?? "",
    });
  }

  // --- Asset sheet --------------------------------------------------------
  const assetRaw = assetRows.map((a) => (a.rawRow ?? {}) as Row);
  const assetHeaders = orderHeaders(assetRaw, IKC_ASSET_FIELDS);
  const assetSheet = wb.addWorksheet("Asset");
  assetSheet.columns = assetHeaders.map((h) => ({ header: h, key: h, width: 24 }));
  for (const a of assetRows) {
    const raw = (a.rawRow ?? {}) as Row;
    assetSheet.addRow(Object.fromEntries(assetHeaders.map((h) => [h, cell(raw[h])])));
  }

  for (const sheet of [colSheet, assetSheet]) {
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  }

  const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
  return { buffer, attributeRows: attrRows.length, assetRows: assetRows.length, filled };
}
