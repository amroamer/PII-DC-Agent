/**
 * Deterministic attribute classification rule table. Rules are DATA, not code
 * branches — the default set is seeded into app_settings under `classification_rules`
 * and can be edited from the Settings page without a redeploy. classifyByRules()
 * evaluates them top-down; the first match wins. An existing IKC column
 * classification acts as a FLOOR (we never downgrade below it).
 */
import type { CriterionCode } from "@shared/lib/criteria";
import type { ClassificationCode } from "@shared/lib/classification";
import { moreRestrictive } from "@shared/lib/classification";
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

export const DEFAULT_CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    id: "special-category",
    isSpecialCategory: true,
    level: "SECRET",
    note: "Special category data is classified Secret.",
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
    level: "INTERNAL",
    note: "Contextual personal data is Internal.",
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
    level: "INTERNAL",
    note: "Uncertain verdicts are held at Internal pending review.",
  },
  {
    id: "not-pii",
    verdict: "not_pii",
    level: "PUBLIC",
    note: "Non-personal data defaults to Public.",
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
      level: "INTERNAL" as ClassificationCode,
      note: "No rule matched; defaulted to Internal.",
    };

  // IKC's existing column classification is a floor — never downgrade below it.
  const level = input.existingLevel
    ? moreRestrictive(matched.level, input.existingLevel)
    : matched.level;

  return { level, ruleId: matched.id, note: matched.note };
}
