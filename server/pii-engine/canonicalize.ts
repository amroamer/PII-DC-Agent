/**
 * Deterministic model-input construction (Prompt 2 §7.2). The same attributes,
 * canonicalised the same way, always produce the same payload and the same hash —
 * a governance requirement, not a nicety.
 *
 *  - Unicode NFC normalisation on every string (mandatory — Arabic descriptions
 *    otherwise hash differently across sources)
 *  - trim + collapse internal whitespace
 *  - null / empty string -> a single sentinel
 *  - object keys emitted in a fixed declared order; the hash sorts keys
 *  - attributes sorted by (assetId, columnName) — never DB return order
 *  - batches derived from the sorted list + a fixed size (reproducible boundaries)
 */
import { createHash } from "node:crypto";
import type { Attribute } from "@shared/models/schema";

export const SENTINEL = "␀"; // single sentinel for null/empty

export function normStr(value: string | null | undefined): string {
  if (value === null || value === undefined) return SENTINEL;
  const n = value.normalize("NFC").trim().replace(/\s+/g, " ");
  return n === "" ? SENTINEL : n;
}

export interface CanonicalAttribute {
  assetId: number;
  columnName: string;
  descriptionEn: string;
  descriptionAr: string;
  dataType: string;
  nativeType: string;
  assetName: string;
  businessDomain: string;
  subjectArea: string;
  siblingColumns: string;
}

export function canonicalizeAttribute(
  attr: Pick<Attribute, "assetId" | "columnName" | "descriptionEn" | "descriptionAr" | "dataType" | "nativeType">,
  asset: { name: string; businessDomain: string | null; subjectArea: string | null } | undefined,
  siblings: string[],
): CanonicalAttribute {
  // Keys are emitted in this fixed declared order.
  return {
    assetId: attr.assetId,
    columnName: normStr(attr.columnName),
    descriptionEn: normStr(attr.descriptionEn),
    descriptionAr: normStr(attr.descriptionAr),
    dataType: normStr(attr.dataType),
    nativeType: normStr(attr.nativeType),
    assetName: normStr(asset?.name),
    businessDomain: normStr(asset?.businessDomain),
    subjectArea: normStr(asset?.subjectArea),
    siblingColumns: siblings.map(normStr).sort().join("|"),
  };
}

export function sortCanonical<T extends { assetId: number; columnName: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => a.assetId - b.assetId || a.columnName.localeCompare(b.columnName),
  );
}

export function batchify<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  const step = Math.max(1, size);
  for (let i = 0; i < items.length; i += step) batches.push(items.slice(i, i + step));
  return batches;
}

/** Stable JSON: object keys sorted so encoding is independent of insertion order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export interface HashInputs {
  payload: CanonicalAttribute;
  promptVersion: string;
  frameworkVersion: string;
  modelId: string;
  engineVersion: string;
  schemaVersion: string;
  /** The fully-composed system prompt (incl. injected criteria) — any change to it
   *  must miss the cache, independent of the frameworkVersion label. */
  systemPrompt: string;
}

/** sha256 over canonical payload + all version identifiers (Prompt 2 §7.3). */
export function computeInputHash(inputs: HashInputs): string {
  const material = [
    stableStringify(inputs.payload),
    inputs.promptVersion,
    inputs.frameworkVersion,
    inputs.modelId,
    inputs.engineVersion,
    inputs.schemaVersion,
    inputs.systemPrompt,
  ].join("␟");
  return createHash("sha256").update(material).digest("hex");
}
