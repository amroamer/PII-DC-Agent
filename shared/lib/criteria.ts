/**
 * The five personal-data criteria of the ADC Personal Data Tagging Policy
 * Framework (DGO-FM-002-01). Defined ONCE here and imported by both the client
 * and the server — no criterion string literals anywhere else in the codebase.
 *
 * evaluationMode drives WHICH engine layers may resolve a criterion:
 *   - "intrinsic"   : decidable from the attribute's own metadata / class library
 *                     (detection layers 1–2). e.g. DIRECT_ID, SPECIAL_CATEGORY.
 *   - "contextual"  : requires semantic inference (layer 3) and/or the asset-scoped
 *                     co-occurrence pass. e.g. INDIRECT_ID, REGULATORY, CONTEXTUAL.
 */

export const CRITERION_CODES = [
  "DIRECT_ID",
  "INDIRECT_ID",
  "REGULATORY",
  "CONTEXTUAL",
  "SPECIAL_CATEGORY",
] as const;

export type CriterionCode = (typeof CRITERION_CODES)[number];

/** Named constants so no criterion string literal is needed elsewhere. */
export const DIRECT_ID_CODE: CriterionCode = "DIRECT_ID";
export const SPECIAL_CATEGORY_CODE: CriterionCode = "SPECIAL_CATEGORY";

export type EvaluationMode = "intrinsic" | "contextual";

export interface CriterionDef {
  code: CriterionCode;
  nameEn: string;
  nameAr: string;
  description: string;
  evaluationMode: EvaluationMode;
}

export const POLICY_CRITERIA: Record<CriterionCode, CriterionDef> = {
  DIRECT_ID: {
    code: "DIRECT_ID",
    nameEn: "Direct Identifier",
    nameAr: "معرّف مباشر",
    description:
      "Data that on its own uniquely identifies a natural person (e.g. Emirates ID number, passport number, full name).",
    evaluationMode: "intrinsic",
  },
  INDIRECT_ID: {
    code: "INDIRECT_ID",
    nameEn: "Indirect Identifier",
    nameAr: "معرّف غير مباشر",
    description:
      "A quasi-identifier that can single out a person when combined with other attributes (e.g. date of birth + nationality + gender).",
    evaluationMode: "contextual",
  },
  REGULATORY: {
    code: "REGULATORY",
    nameEn: "Regulatory / Legal Designation",
    nameAr: "تصنيف تنظيمي أو قانوني",
    description:
      "Data designated as personal by a governing law or regulation applicable to ADC (e.g. UAE PDPL, customs declarant records).",
    evaluationMode: "contextual",
  },
  CONTEXTUAL: {
    code: "CONTEXTUAL",
    nameEn: "Contextual Personal Data",
    nameAr: "بيانات شخصية سياقية",
    description:
      "Data that becomes personal because of the context of the asset it belongs to (e.g. a code that is only meaningful inside a traveller record).",
    evaluationMode: "contextual",
  },
  SPECIAL_CATEGORY: {
    code: "SPECIAL_CATEGORY",
    nameEn: "Special Category Data",
    nameAr: "بيانات الفئات الخاصة",
    description:
      "Sensitive data requiring heightened protection (e.g. health, biometrics, religious or political affiliation).",
    evaluationMode: "intrinsic",
  },
};

export const POLICY_CRITERIA_LIST: CriterionDef[] = CRITERION_CODES.map(
  (code) => POLICY_CRITERIA[code],
);

export function isCriterionCode(value: unknown): value is CriterionCode {
  return typeof value === "string" && (CRITERION_CODES as readonly string[]).includes(value);
}

export function criterionName(code: CriterionCode, lang: "en" | "ar" = "en"): string {
  const def = POLICY_CRITERIA[code];
  return lang === "ar" ? def.nameAr : def.nameEn;
}

/** Intrinsic criteria are resolvable from detection layers 1–2 alone. */
export function isIntrinsic(code: CriterionCode): boolean {
  return POLICY_CRITERIA[code].evaluationMode === "intrinsic";
}
