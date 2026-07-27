/**
 * Deterministic attribute classification rule table. Rules are DATA, not code
 * branches — the default set is seeded into app_settings under `classification_rules`
 * and can be edited from the Settings page without a redeploy. classifyByRules()
 * evaluates them top-down; the first match wins. An existing IKC column
 * classification acts as a FLOOR (we never downgrade below it).
 */
import type { CriterionCode } from "@shared/lib/criteria";
import type { ClassificationCode } from "@shared/lib/classification";
import { levelLabel, levelRank, moreRestrictive } from "@shared/lib/classification";
import type { DetectionVerdict } from "@shared/models/schema";

export interface ClassificationRule {
  id: string;
  /** undefined fields are wildcards. */
  isSpecialCategory?: boolean;
  criterion?: CriterionCode;
  verdict?: DetectionVerdict;
  level: ClassificationCode;
  note: string;
}

// Mapping per the DGE WoG Data Classification Framework v1.0 §8.2: personal data
// defaults to Confidential; health/biometric (special category) is Sensitive;
// Confidential is the default for all data. Secret is reserved for contextual
// cases the engine cannot detect from metadata (classified government data,
// national defense, high-ranking individuals) and is only reached via an IKC
// floor or a steward override.
export const DEFAULT_CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    id: "special-category",
    isSpecialCategory: true,
    level: "SENSITIVE",
    note: "Special category data (health, biometric) is classified Sensitive.",
  },
  {
    id: "direct-id",
    criterion: "DIRECT_ID",
    verdict: "pii",
    level: "CONFIDENTIAL",
    note: "Direct identifiers are Confidential.",
  },
  {
    id: "regulatory",
    criterion: "REGULATORY",
    verdict: "pii",
    level: "CONFIDENTIAL",
    note: "Regulatory personal data is Confidential.",
  },
  {
    id: "indirect-id",
    criterion: "INDIRECT_ID",
    verdict: "pii",
    level: "CONFIDENTIAL",
    note: "Quasi-identifiers are Confidential.",
  },
  {
    id: "contextual",
    criterion: "CONTEXTUAL",
    verdict: "pii",
    level: "CONFIDENTIAL",
    note: "Contextual personal data is Confidential.",
  },
  {
    id: "pii-generic",
    verdict: "pii",
    level: "CONFIDENTIAL",
    note: "Personal data defaults to Confidential.",
  },
  {
    id: "uncertain",
    verdict: "uncertain",
    level: "CONFIDENTIAL",
    note: "Uncertain verdicts default to Confidential (framework default for all data).",
  },
  {
    id: "not-pii",
    verdict: "not_pii",
    level: "CONFIDENTIAL",
    note: "Non-personal data defaults to Confidential; Open requires an affirmative public determination.",
  },
];

export interface AttributeRuleInput {
  verdict: DetectionVerdict;
  criterion: CriterionCode | null;
  isSpecialCategory: boolean;
  existingLevel: ClassificationCode | null;
}

export interface AttributeRuleResult {
  level: ClassificationCode;
  ruleId: string;
  note: string;
}

export function classifyByRules(
  input: AttributeRuleInput,
  rules: ClassificationRule[],
): AttributeRuleResult {
  const matched =
    rules.find((r) => {
      if (r.isSpecialCategory !== undefined && r.isSpecialCategory !== input.isSpecialCategory)
        return false;
      if (r.criterion !== undefined && r.criterion !== input.criterion) return false;
      if (r.verdict !== undefined && r.verdict !== input.verdict) return false;
      return true;
    }) ?? {
      id: "fallback",
      level: "CONFIDENTIAL" as ClassificationCode,
      note: "No rule matched; defaulted to Confidential.",
    };

  // IKC's existing column classification is a floor — never downgrade below it.
  const level = input.existingLevel
    ? moreRestrictive(matched.level, input.existingLevel)
    : matched.level;

  return { level, ruleId: matched.id, note: matched.note };
}

/**
 * Reconcile the classification LLM's suggested level with the deterministic rule
 * floor. ESCALATE-ONLY: the LLM can only RAISE above the floor (e.g. Confidential →
 * Secret for enforcement context, or → Sensitive for special category); it can never
 * lower a column below the governance floor (personal data / IKC / special category).
 * When the LLM is unavailable (llmLevel === null), the floor stands unchanged, so a
 * run stays correct offline.
 */
export function reconcileLevel(
  llmLevel: ClassificationCode | null,
  ruleFloor: ClassificationCode,
): ClassificationCode {
  return llmLevel ? moreRestrictive(llmLevel, ruleFloor) : ruleFloor;
}

/**
 * A one-sentence, bilingual note explaining WHY the final level differs from the
 * model's own assessment — i.e. the governance floor raised it. Returned empty when
 * the model and final levels agree (nothing to explain). Distinguishes the two floor
 * sources a steward cares about: the column's existing catalog classification (the
 * engine never downgrades below it) vs. the special-category / personal-data policy.
 * This text is stored on the run item, so it also lands in the approved
 * classification record and the Excel export.
 */
export function reconciliationNote(
  modelLevel: ClassificationCode | null,
  finalLevel: ClassificationCode,
  existingLevel: ClassificationCode | null,
  includeArabic: boolean,
): { en: string; ar: string } {
  if (!modelLevel || modelLevel === finalLevel) return { en: "", ar: "" };
  const heldByExisting = existingLevel !== null && levelRank(existingLevel) >= levelRank(finalLevel);
  const en =
    `Final level ${levelLabel(finalLevel)}: the AI model assessed ${levelLabel(modelLevel)}, but the engine raised it — ` +
    (heldByExisting
      ? `held at the column's existing catalog classification (${levelLabel(existingLevel!)}); the engine never downgrades below it.`
      : `the special-category / personal-data policy floor applies.`) +
    " ";
  const ar = includeArabic
    ? `المستوى النهائي ${levelLabel(finalLevel, "ar")}: قيّم النموذج ${levelLabel(modelLevel, "ar")}، لكن المحرك رفعه — ` +
      (heldByExisting
        ? `مثبّت عند التصنيف الحالي للعمود (${levelLabel(existingLevel!, "ar")})؛ ولا يخفّضه المحرك دون ذلك.`
        : `بسبب الحد الأدنى لسياسة الفئة الخاصة/البيانات الشخصية.`) +
      " "
    : "";
  return { en, ar };
}
