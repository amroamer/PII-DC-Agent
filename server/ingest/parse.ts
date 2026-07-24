import * as XLSX from "xlsx";
import type { ClassificationCode } from "@shared/lib/classification";
import { isClassificationCode } from "@shared/lib/classification";
import type { IkcSheetType } from "@shared/lib/ikc-fields";

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, unknown>[];
}

/** Read the first worksheet of an uploaded IKC export into header + row objects. */
export function parseWorkbook(buffer: Buffer): ParsedSheet {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };

  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: null,
    raw: false,
  });

  const headerMatrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 });
  const headers = (headerMatrix[0] as unknown[] | undefined)?.map((h) => String(h ?? "").trim()) ?? [];

  return { headers: headers.filter(Boolean), rows };
}

/** Best-effort guess of which IKC sheet was uploaded, from the header set. */
export function guessSheetType(headers: string[]): IkcSheetType {
  const norm = headers.map((h) => h.toLowerCase());
  const looksLikeAttribute = norm.some(
    (h) => h.includes("column") || h.includes("attribute") || h.includes("field"),
  );
  return looksLikeAttribute ? "attribute" : "asset";
}

// --- value coercion helpers -------------------------------------------------

export function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

export function asBool(value: unknown): boolean {
  const s = asString(value)?.toLowerCase();
  if (!s) return false;
  return ["true", "yes", "y", "1", "pii", "cde", "x"].includes(s);
}

export function asNumber(value: unknown): number | null {
  const s = asString(value);
  if (s === null) return null;
  const n = Number(s.replace("%", ""));
  if (Number.isNaN(n)) return null;
  // Normalise a percentage confidence (e.g. "85") to 0..1.
  return n > 1 ? Math.min(n / 100, 1) : n;
}

/** Plain integer (no percentage normalisation) — for length/scale/counts. */
export function asInt(value: unknown): number | null {
  const s = asString(value);
  if (s === null) return null;
  const n = Number.parseInt(s.replace(/[^0-9-]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

/** Plain number (no 0..1 normalisation) — for quality scores 0..100. */
export function asRawNumber(value: unknown): number | null {
  const s = asString(value);
  if (s === null) return null;
  const n = Number(s.replace("%", ""));
  return Number.isNaN(n) ? null : n;
}

export function asStringArray(value: unknown): string[] | null {
  const s = asString(value);
  if (s === null) return null;
  return s
    .split(/[;,|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function asClassification(value: unknown): ClassificationCode | null {
  const s = asString(value);
  if (s === null) return null;
  const upper = s.toUpperCase().replace(/\s+/g, "_");
  if (isClassificationCode(upper)) return upper;
  // tolerate label spellings
  const map: Record<string, ClassificationCode> = {
    OPEN: "PUBLIC",
    PUBLIC: "PUBLIC",
    INTERNAL: "INTERNAL",
    RESTRICTED: "CONFIDENTIAL",
    CONFIDENTIAL: "CONFIDENTIAL",
    SECRET: "SECRET",
    TOP_SECRET: "SECRET",
  };
  return map[upper] ?? null;
}

/** Apply a canonicalKey -> rawHeader mapping to a raw row. */
export function mapRow(
  row: Record<string, unknown>,
  mapping: Record<string, string | null>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [canonicalKey, rawHeader] of Object.entries(mapping)) {
    out[canonicalKey] = rawHeader && rawHeader in row ? row[rawHeader] : null;
  }
  return out;
}
