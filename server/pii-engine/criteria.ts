/**
 * Maps detection signals onto policy criterion codes.
 *
 * Intrinsic criteria (DIRECT_ID, SPECIAL_CATEGORY) are resolvable from the class
 * library alone (detection layers 1–2). The contextual criteria (INDIRECT_ID,
 * REGULATORY, CONTEXTUAL) require semantic inference (layer 3) and/or the
 * asset-scoped co-occurrence pass — those are set by the LLM layer and the
 * co-occurrence pass respectively, not here.
 */
import type { CriterionCode } from "@shared/lib/criteria";
import { POLICY_CRITERIA } from "@shared/lib/criteria";
import type { CachedDataClass } from "../reference-cache";

/** Criterion implied by a matched data class (layers 1–2, intrinsic only). */
export function criterionForDataClass(dc: CachedDataClass): CriterionCode | null {
  if (dc.isSpecialCategory) return "SPECIAL_CATEGORY";
  if (dc.isPii) return "DIRECT_ID";
  return null;
}

/** Criterion resolved by the asset-scoped co-occurrence pass. */
export const COOCCURRENCE_CRITERION: CriterionCode = "INDIRECT_ID";

export function isIntrinsicCriterion(code: CriterionCode | null): boolean {
  return code !== null && POLICY_CRITERIA[code].evaluationMode === "intrinsic";
}
