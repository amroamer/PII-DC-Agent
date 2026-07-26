import * as XLSX from "xlsx";
import type { ClassificationCode } from "@shared/lib/classification";
import { isClassificationCode } from "@shared/lib/classification";

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, unknown>[];
}

export interface WorkbookSheets {
  /** The "Asset" sheet (one row per data asset), or null if not present. */
  assetSheet: ParsedSheet | null;
  /** The "Columns"/attribute sheet (one row per column), or null if not present. */
  columnSheet: ParsedSheet | null;
  /** Every worksheet name found, for diagnostics. */
  sheetNames: string[];
}

const ASSET_SHEET_NAMES = new Set(["asset", "assets"]);
const COLUMN_SHEET_NAMES = new Set(["columns", "column", "attributes", "attribute"]);

function parseNamedSheet(workbook: XLSX.WorkBook, name: string): ParsedSheet {
  const worksheet = workbook.Sheets[name];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: null,
    raw: false,
  });
  const headerMatrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 });
  const headers = (headerMatrix[0] as unknown[] | undefined)?.map((h) => String(h ?? "").trim()) ?? [];
  return { headers: headers.filter(Boolean), rows };
}

/**
 * Read a single IKC export workbook that carries BOTH sheets — the "Asset" sheet
 * and the "Columns" (attribute) sheet — in one file. Sheets are matched by name
 * (case-insensitive); when the names are unrecognised we fall back to position
 * (first = asset, second = columns) so slightly-renamed exports still load.
 */
export function parseTwoSheetWorkbook(buffer: Buffer): WorkbookSheets {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetNames = workbook.SheetNames;

  let assetName = sheetNames.find((n) => ASSET_SHEET_NAMES.has(n.trim().toLowerCase()));
  let columnName = sheetNames.find((n) => COLUMN_SHEET_NAMES.has(n.trim().toLowerCase()));

  // Positional fallback when the sheets aren't named as we expect.
  if (!assetName && !columnName && sheetNames.length >= 2) {
    [assetName, columnName] = sheetNames;
  } else if (!assetName && sheetNames.length >= 1) {
    assetName = sheetNames.find((n) => n !== columnName);
  } else if (!columnName && sheetNames.length >= 2) {
    columnName = sheetNames.find((n) => n !== assetName);
  }

  return {
    assetSheet: assetName ? parseNamedSheet(workbook, assetName) : null,
    columnSheet: columnName ? parseNamedSheet(workbook, columnName) : null,
    sheetNames,
  };
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

/**
 * Trim, drop empties, de-dupe (order-preserving). Collapses both real whitespace and the
 * LITERAL `\t` / `\n` / `\r` escape sequences IKC embeds via Python `repr()` (e.g.
 * `'Finance\tFinancial - Revenue'`, `'Party\n'`) — those arrive as two characters, not control chars.
 */
function cleanParts(parts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const v = p.replace(/\\[tnr]/g, " ").replace(/\s+/g, " ").trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * Parse a possibly list-shaped cell into a clean string[]. Handles the shapes IKC
 * exports: JSON arrays `["a","b"]`, Python list literals `['a', 'b']`, and plain
 * delimited strings `"a; b"`. Empty (incl. `[]`) → null.
 */
export function asList(value: unknown): string[] | null {
  const s = asString(value);
  if (s === null) return null;

  let parts: string[];
  if (/^\[.*\]$/s.test(s)) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(s);
    } catch {
      /* Python single-quoted literal — handled below. */
    }
    if (Array.isArray(parsed)) {
      // Objects (e.g. a stray JSON-object array) collapse to "" and get dropped.
      parts = parsed.map((x) => (x !== null && typeof x === "object" ? "" : String(x ?? "")));
    } else {
      // Pull the quoted segments out of a Python list literal (single or double quotes).
      parts = [...s.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? "");
    }
  } else {
    parts = s.split(/[;,|]/);
  }

  const cleaned = cleanParts(parts);
  return cleaned.length ? cleaned : null;
}

/**
 * Parse the IKC "Suggested Data Classes" JSON — an array of `{name, confidence, …}`
 * objects — into a clean list of class names. Falls back to asList for non-JSON input.
 */
export function asClassNames(value: unknown): string[] | null {
  const s = asString(value);
  if (s === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return asList(s);
  }
  if (!Array.isArray(parsed)) return asList(s);
  const names = parsed.map((item) =>
    item !== null && typeof item === "object"
      ? String((item as Record<string, unknown>).name ?? "")
      : String(item ?? ""),
  );
  const cleaned = cleanParts(names);
  return cleaned.length ? cleaned : null;
}

export function asClassification(value: unknown): ClassificationCode | null {
  const s = asString(value);
  if (s === null) return null;
  const upper = s.toUpperCase().replace(/\s+/g, "_");
  if (isClassificationCode(upper)) return upper;
  // tolerate label spellings, incl. legacy scales (Public/Internal/Restricted/Top Secret)
  const map: Record<string, ClassificationCode> = {
    OPEN: "OPEN",
    PUBLIC: "OPEN",
    INTERNAL: "CONFIDENTIAL",
    RESTRICTED: "CONFIDENTIAL",
    CONFIDENTIAL: "CONFIDENTIAL",
    SENSITIVE: "SENSITIVE",
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
