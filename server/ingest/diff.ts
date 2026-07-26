/**
 * Field-level diff for the single-file, two-sheet IKC import (Asset + Columns).
 *
 * Core rule (kept deliberately safe): a re-upload only ever *adds* new rows or
 * *updates the specific fields whose incoming value is both present and actually
 * different*. Blank/empty cells carry "no information" and NEVER overwrite or
 * clear an existing value — so uploading the same file twice yields zero changes,
 * and the steward is only ever shown the fields that genuinely changed.
 *
 * This module is pure (no DB): it takes already-loaded catalog rows and the
 * parsed sheet rows and returns an apply-plan + a human-readable change list.
 * The DB load + transactional apply live in import.ts.
 */
import type { Asset, Attribute } from "@shared/models/schema";
import { IKC_ASSET_FIELDS, IKC_ATTRIBUTE_FIELDS } from "@shared/lib/ikc-fields";
import {
  asBool,
  asClassNames,
  asClassification,
  asInt,
  asList,
  asNumber,
  asRawNumber,
  asString,
  mapRow,
} from "./parse";

/** A coerced incoming value; `undefined` means "no value in this cell" → ignored. */
type Incoming = string | number | boolean | string[] | null | undefined;

// --- cell coercion: empty always collapses to `undefined` (no info) ----------
const txt = (v: unknown): Incoming => asString(v) ?? undefined;
const intg = (v: unknown): Incoming => asInt(v) ?? undefined;
const num = (v: unknown): Incoming => asNumber(v) ?? undefined;
const rawNum = (v: unknown): Incoming => asRawNumber(v) ?? undefined;
/** Multi-value facet: parse a list literal / delimited string into a clean string[]. */
const list = (v: unknown): Incoming => asList(v) ?? undefined;
/** Single value drawn from a (possibly list-wrapped) cell, e.g. `['Monthly']` → `Monthly`. */
const firstOf = (v: unknown): Incoming => asList(v)?.[0] ?? undefined;
/** IKC "Suggested Data Classes" JSON → clean class names. */
const classNames = (v: unknown): Incoming => asClassNames(v) ?? undefined;
const cls = (v: unknown): Incoming => asClassification(v) ?? undefined;
/** A boolean only counts when the cell is non-empty (explicit yes/no). */
const flag = (v: unknown): Incoming => (asString(v) === null ? undefined : asBool(v));

interface FieldSpec {
  /** key in the column mapping (IKC field key). */
  mapKey: string;
  /** target DB column on assets/attributes. */
  column: string;
  /** display label shown to the steward. */
  label: string;
  coerce: (v: unknown) => Incoming;
}

const assetLabel = (key: string): string =>
  IKC_ASSET_FIELDS.find((f) => f.key === key)?.header ?? key;
const attrLabel = (key: string): string =>
  IKC_ATTRIBUTE_FIELDS.find((f) => f.key === key)?.header ?? key;

const spec = (
  mapKey: string,
  column: string,
  coerce: (v: unknown) => Incoming,
  label: string,
): FieldSpec => ({ mapKey, column, coerce, label });

// ikcAssetId (match key) and name are handled separately below.
const ASSET_SPECS: FieldSpec[] = [
  spec("descriptionEn", "descriptionEn", txt, assetLabel("descriptionEn")),
  spec("descriptionAr", "descriptionAr", txt, assetLabel("descriptionAr")),
  spec("assetType", "assetType", txt, assetLabel("assetType")),
  spec("businessDomain", "businessDomain", list, assetLabel("businessDomain")),
  spec("subjectArea", "subjectArea", list, assetLabel("subjectArea")),
  spec("department", "department", list, assetLabel("department")),
  spec("sector", "sector", list, assetLabel("sector")),
  spec("owner", "ownerId", txt, assetLabel("owner")),
  spec("stewards", "stewards", list, assetLabel("stewards")),
  spec("storage", "storage", txt, assetLabel("storage")),
  spec("retentionPeriod", "retentionPeriod", txt, assetLabel("retentionPeriod")),
  spec("piiFlag", "piiFlag", flag, assetLabel("piiFlag")),
  spec("cdeFlag", "cdeFlag", flag, assetLabel("cdeFlag")),
  spec("assetClassification", "assetClassification", cls, assetLabel("assetClassification")),
  spec("catalogId", "catalogId", txt, assetLabel("catalogId")),
  spec("creatorId", "creatorId", txt, assetLabel("creatorId")),
  spec("tableType", "tableType", txt, assetLabel("tableType")),
  spec("tableSchema", "tableSchema", txt, assetLabel("tableSchema")),
  spec("connectionId", "connectionId", txt, assetLabel("connectionId")),
  spec("connectionPath", "connectionPath", txt, assetLabel("connectionPath")),
  spec("backupFrequency", "backupFrequency", firstOf, assetLabel("backupFrequency")),
  spec("numColumns", "numColumns", intg, assetLabel("numColumns")),
  spec("numChildren", "numChildren", intg, assetLabel("numChildren")),
  spec("qualityScore", "qualityScore", rawNum, assetLabel("qualityScore")),
  spec("analysedRowCount", "analysedRowCount", intg, assetLabel("analysedRowCount")),
  spec("tags", "tags", list, assetLabel("tags")),
];

// ikcAssetId (parent match key), assetName (asset fallback name) and columnName
// (row match key) are handled separately below.
const ATTRIBUTE_SPECS: FieldSpec[] = [
  spec("descriptionEn", "descriptionEn", txt, attrLabel("descriptionEn")),
  spec("descriptionAr", "descriptionAr", txt, attrLabel("descriptionAr")),
  spec("dataType", "dataType", txt, attrLabel("dataType")),
  spec("nativeType", "nativeType", txt, attrLabel("nativeType")),
  spec("isPrimaryKey", "isPrimaryKey", flag, attrLabel("isPrimaryKey")),
  spec("nullable", "nullable", flag, attrLabel("nullable")),
  spec("selectedDataClassName", "selectedDataClassName", txt, attrLabel("selectedDataClassName")),
  spec("selectedDataClassConfidence", "selectedDataClassConfidence", num, attrLabel("selectedDataClassConfidence")),
  spec("suggestedClasses", "suggestedClasses", classNames, attrLabel("suggestedClasses")),
  spec("columnDataClassification", "columnDataClassification", cls, attrLabel("columnDataClassification")),
  spec("piiName", "piiName", txt, attrLabel("piiName")),
  spec("piiDescription", "piiDescription", txt, attrLabel("piiDescription")),
  spec("cdeFlag", "cdeFlag", flag, attrLabel("cdeFlag")),
  spec("length", "length", intg, attrLabel("length")),
  spec("scale", "scale", intg, attrLabel("scale")),
  spec("signed", "signed", flag, attrLabel("signed")),
  spec("qualityScore", "qualityScore", rawNum, attrLabel("qualityScore")),
];

// --- comparison + display ----------------------------------------------------

/** True when an incoming (present) value matches what's already stored. */
export function valuesEqual(incoming: Exclude<Incoming, undefined>, stored: unknown): boolean {
  if (Array.isArray(incoming)) {
    return JSON.stringify(incoming) === JSON.stringify(Array.isArray(stored) ? stored : []);
  }
  if (typeof incoming === "number") {
    if (typeof stored !== "number") return false;
    const diff = Math.abs(incoming - stored);
    // Tolerance absorbs float4 (real) round-trip drift so quality scores etc.
    // don't show up as spurious changes on re-upload.
    return diff <= 1e-6 || diff <= Math.abs(incoming) * 1e-5;
  }
  if (typeof incoming === "boolean") {
    return stored != null && incoming === Boolean(stored);
  }
  return stored != null && String(incoming) === String(stored);
}

function display(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

// --- plan shapes -------------------------------------------------------------

export interface FieldChange {
  field: string;
  label: string;
  from: string;
  to: string;
}

export type RowStatus = "new" | "changed" | "unchanged";

export interface AssetOp {
  ikcAssetId: string;
  name: string;
  status: RowStatus;
  existingId?: number;
  /** columns to write (new: all present fields; changed: only differing fields). */
  values: Record<string, unknown>;
  changes: FieldChange[];
  rawRow: Record<string, unknown>;
}

export interface AttributeOp {
  ikcAssetId: string;
  columnName: string;
  /** Parent asset's display name (for previews); falls back to the asset id. */
  assetName: string;
  status: RowStatus;
  existingId?: number;
  values: Record<string, unknown>;
  changes: FieldChange[];
  rawRow: Record<string, unknown>;
}

export interface DiffCounts {
  new: number;
  changed: number;
  unchanged: number;
}

const emptyCounts = (): DiffCounts => ({ new: 0, changed: 0, unchanged: 0 });
const tally = (counts: DiffCounts, status: RowStatus) => {
  if (status === "new") counts.new++;
  else if (status === "changed") counts.changed++;
  else counts.unchanged++;
};

/**
 * Diff the incoming Asset rows against the current catalog.
 * `mapping` is canonicalKey -> raw header (from autoMapColumns).
 */
export function buildAssetOps(
  rows: Record<string, unknown>[],
  mapping: Record<string, string | null>,
  existingAssets: Asset[],
): { ops: AssetOp[]; counts: DiffCounts; skipped: number } {
  const byIkcId = new Map<string, Asset>();
  for (const a of existingAssets) byIkcId.set(a.ikcAssetId, a);

  const ops: AssetOp[] = [];
  const counts = emptyCounts();
  let skipped = 0;
  const seen = new Set<string>();

  for (const raw of rows) {
    const m = mapRow(raw, mapping);
    const ikcAssetId = asString(m.ikcAssetId);
    if (!ikcAssetId) {
      skipped++;
      continue;
    }
    if (seen.has(ikcAssetId)) {
      // Duplicate asset row within the same sheet — keep the first, ignore rest.
      skipped++;
      continue;
    }
    seen.add(ikcAssetId);

    const existing = byIkcId.get(ikcAssetId);
    const incomingName = asString(m.name);
    const values: Record<string, unknown> = {};
    const changes: FieldChange[] = [];

    // name is special: present-and-different updates; a new asset falls back to id.
    if (incomingName && (!existing || incomingName !== existing.name)) {
      values.name = incomingName;
      changes.push({
        field: "name",
        label: assetLabel("name"),
        from: existing ? existing.name : "",
        to: incomingName,
      });
    }

    for (const s of ASSET_SPECS) {
      const incoming = s.coerce(m[s.mapKey]);
      if (incoming === undefined) continue;
      const stored = existing ? (existing as Record<string, unknown>)[s.column] : undefined;
      if (!existing || !valuesEqual(incoming, stored)) {
        values[s.column] = incoming;
        changes.push({
          field: s.column,
          label: s.label,
          from: existing ? display(stored) : "",
          to: display(incoming),
        });
      }
    }

    let status: RowStatus;
    if (!existing) {
      status = "new";
      values.ikcAssetId = ikcAssetId;
      if (!values.name) values.name = incomingName ?? ikcAssetId;
    } else if (changes.length > 0) {
      status = "changed";
    } else {
      status = "unchanged";
    }

    tally(counts, status);
    ops.push({
      ikcAssetId,
      name: (values.name as string) ?? existing?.name ?? ikcAssetId,
      status,
      existingId: existing?.id,
      values,
      changes,
      rawRow: raw,
    });
  }

  return { ops, counts, skipped };
}

/**
 * Diff the incoming Column rows against the current catalog. Attributes are
 * matched by (parent Asset Id + Column Name). `existingAttrByKey` is keyed by
 * `${ikcAssetId}::${columnName}`.
 */
export function buildAttributeOps(
  rows: Record<string, unknown>[],
  mapping: Record<string, string | null>,
  existingAttrByKey: Map<string, Attribute>,
): { ops: AttributeOp[]; counts: DiffCounts; skipped: number } {
  const ops: AttributeOp[] = [];
  const counts = emptyCounts();
  let skipped = 0;
  const seen = new Set<string>();

  for (const raw of rows) {
    const m = mapRow(raw, mapping);
    const ikcAssetId = asString(m.ikcAssetId);
    const columnName = asString(m.columnName);
    if (!ikcAssetId || !columnName) {
      skipped++;
      continue;
    }
    const key = `${ikcAssetId}::${columnName}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);

    const existing = existingAttrByKey.get(key);
    const values: Record<string, unknown> = {};
    const changes: FieldChange[] = [];

    for (const s of ATTRIBUTE_SPECS) {
      const incoming = s.coerce(m[s.mapKey]);
      if (incoming === undefined) continue;
      const stored = existing ? (existing as Record<string, unknown>)[s.column] : undefined;
      if (!existing || !valuesEqual(incoming, stored)) {
        values[s.column] = incoming;
        changes.push({
          field: s.column,
          label: s.label,
          from: existing ? display(stored) : "",
          to: display(incoming),
        });
      }
    }

    let status: RowStatus;
    if (!existing) status = "new";
    else if (changes.length > 0) status = "changed";
    else status = "unchanged";

    tally(counts, status);
    ops.push({
      ikcAssetId,
      columnName,
      assetName: asString(m.assetName) ?? ikcAssetId,
      status,
      existingId: existing?.id,
      values,
      changes,
      rawRow: raw,
    });
  }

  return { ops, counts, skipped };
}
