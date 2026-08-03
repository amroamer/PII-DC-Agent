/**
 * Presentation logic for detection results — pure, so it can be unit tested and
 * shared between the read API (server-side ordering) and the tables.
 *
 * The engine's own ordering is confidence-descending, which is exactly backwards
 * for a review screen: a 99%-certain "not personal" row is the least interesting
 * thing on the page. These helpers order by how much human attention a row needs,
 * and summarise the per-layer agreement that the flat layer chips used to hide.
 */
import type { DetectionLayer, DetectionVerdict } from "../models/schema";
import { isCriterionCode } from "./criteria";

/** The subset of a merged decision the ordering cares about. */
export interface AttentionInput {
  verdict: DetectionVerdict;
  confidence: number;
  conflict: boolean;
  nearThreshold?: boolean;
}

/**
 * Lower rank = shown first.
 *  0 layers disagree — the engine deliberately refused to pick a winner
 *  1 uncertain verdict
 *  2 PII sitting within a hair of the review threshold (a weak positive)
 *  3 PII
 *  4 not PII
 */
export function attentionRank(d: AttentionInput): number {
  if (d.conflict) return 0;
  if (d.verdict === "uncertain") return 1;
  if (d.verdict === "pii") return d.nearThreshold ? 2 : 3;
  return 4;
}

/**
 * Attention-first ordering. Within a rank:
 *  - PII rows lead with the strongest findings (the actual PII inventory);
 *  - everything else leads with the *weakest* rows, because a low-confidence
 *    "not personal" is the one most likely to be wrong.
 */
export function compareByAttention(a: AttentionInput, b: AttentionInput): number {
  const ra = attentionRank(a);
  const rb = attentionRank(b);
  if (ra !== rb) return ra - rb;
  const strongestFirst = a.verdict === "pii" && !a.conflict;
  return strongestFirst ? b.confidence - a.confidence : a.confidence - b.confidence;
}

export const LAYER_LABELS: Record<DetectionLayer, string> = {
  ikc_class: "IKC",
  adc_class: "ADC",
  llm: "LLM",
};

/** Canonical display order — deterministic regardless of insert order. */
const LAYER_ORDER: DetectionLayer[] = ["ikc_class", "adc_class", "llm"];

export interface LayerSummaryEntry {
  layer: DetectionLayer;
  label: string;
  verdict: DetectionVerdict;
  confidence: number;
  /** False when this layer voted against the merged verdict. */
  agrees: boolean;
}

/**
 * One entry per layer that produced a signal, flagged against the merged verdict.
 * Multiple rows from the same layer collapse to the highest-confidence one.
 */
export function layerSummary(
  layers: Array<{ layer: DetectionLayer; verdict: DetectionVerdict; confidence: number }>,
  mergedVerdict: DetectionVerdict,
): LayerSummaryEntry[] {
  const best = new Map<DetectionLayer, { verdict: DetectionVerdict; confidence: number }>();
  for (const l of layers) {
    const prev = best.get(l.layer);
    if (!prev || l.confidence > prev.confidence) best.set(l.layer, { verdict: l.verdict, confidence: l.confidence });
  }
  return LAYER_ORDER.filter((code) => best.has(code)).map((code) => {
    const { verdict, confidence } = best.get(code)!;
    return {
      layer: code,
      label: LAYER_LABELS[code],
      verdict,
      confidence,
      agrees: verdict === mergedVerdict,
    };
  });
}

/**
 * A confidence reading is only worth a column when it can change a decision.
 * At 99% on every row it is pure noise — so the table renders the meter for the
 * doubtful rows and a muted number for the rest.
 */
export function isConfidenceNotable(d: AttentionInput, threshold = 0.6): boolean {
  return d.conflict || d.nearThreshold === true || d.verdict === "uncertain" || d.confidence < threshold + 0.15;
}

/**
 * The LLM layer frequently stores the criterion code as its data class, which
 * would render "DIRECT_ID" in both the Criterion and Data class cells. Only
 * report a data class that adds something the criterion badge doesn't.
 */
export function displayDataClass(d: { dataClassCode: string | null; criterion: string | null }): string | null {
  const code = d.dataClassCode;
  if (!code) return null;
  if (code === d.criterion || isCriterionCode(code)) return null;
  return code;
}

/**
 * IKC class names that describe a column's SHAPE rather than what it holds.
 * "NoClassDetected" alone covers 8.8k of this catalog's columns — rendering it
 * as a PII type fills the column with a word that means "we found nothing".
 */
const GENERIC_IKC_CLASSES = new Set(
  ["noclassdetected", "text", "date", "time", "code", "indicator", "boolean", "identifier", "quantity", "number", "numeric", "month", "unknown", "none", "n/a"],
);

export interface PiiTypeInput {
  verdict: DetectionVerdict | null;
  piiName?: string | null;
  dataClassCode?: string | null;
  criterion?: string | null;
  selectedDataClassName?: string | null;
}

/**
 * What kind of personal data this column holds — the field that actually varies
 * row to row on a PII-filtered catalog.
 *
 * A class is only reported when the column is (or might be) personal: pairing
 * "Not Personal" with "EMIRATES_ID" in the next cell reads as a contradiction,
 * and the engine does emit a data class alongside a negative verdict.
 */
export function displayPiiType(d: PiiTypeInput): string | null {
  if (d.verdict === "not_pii") return null;
  if (d.piiName) return d.piiName;
  const fromEngine = displayDataClass({ dataClassCode: d.dataClassCode ?? null, criterion: d.criterion ?? null });
  if (fromEngine) return fromEngine;
  const ikc = d.selectedDataClassName?.trim();
  if (!ikc || GENERIC_IKC_CLASSES.has(ikc.toLowerCase())) return null;
  return ikc;
}

/** Collapse a rationale to a single line for a table cell. */
export function oneLine(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}
