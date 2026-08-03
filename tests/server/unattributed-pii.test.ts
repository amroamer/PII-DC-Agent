import { describe, expect, it } from "vitest";
import { inferPiiForAttribute, type InferContext } from "../../server/engine/infer";
import type { CriterionCode } from "@shared/lib/criteria";

/**
 * Invariant: the engine never emits a `pii` verdict without an applied criterion.
 *
 * That state produced 145 rows with a blank "Criteria Matched" cell — findings
 * that cannot be filtered by criterion, defended in an export, or actioned by a
 * steward. It happens when the model judges a column personal for a reason
 * (contextual / regulatory / special-category) that the run was not scoped to
 * score, so every in-scope criterion assesses to false.
 */
const ctx = (activeCriteria: CriterionCode[]): InferContext => ({
  modelId: "test-model",
  promptVersion: "1",
  frameworkVersion: "1",
  frameworkVersionId: null,
  engineVersion: "0.1.0",
  activeCriteria,
  useCache: false,
  forceFresh: true,
  systemPrompt: "test",
  threshold: 0.6,
  seed: 42,
  selfConsistencySamples: 1,
  confidenceFloor: 0.3,
  includeArabic: false,
  shortCircuitOperational: false,
});

const input = (columnName: string) => ({
  attribute: {
    id: 1,
    columnName,
    descriptionEn: "free-text notes captured against a case",
    descriptionAr: null,
    dataType: "nvarchar",
    selectedDataClassName: null,
  },
  asset: { id: 10, name: "DHB_CASE_NOTES", businessDomain: null, subjectArea: null },
  siblingColumnNames: [],
}) as never;

/** An LLM assessment that says "personal" while no in-scope criterion applies. */
const personalButUnattributed = async () => ({
  verdict: "pii" as const,
  suggestedDataClass: "CONTEXTUAL",
  overallConfidence: 0.7,
  rationaleEn: "Free-text remarks can incidentally contain names.",
  rationaleAr: "",
  metadataConflict: false,
  criteria: [
    { code: "DIRECT_ID" as CriterionCode, applies: false, confidence: 0.2, rationaleEn: "not a direct identifier", rationaleAr: "" },
    { code: "INDIRECT_ID" as CriterionCode, applies: false, confidence: 0.3, rationaleEn: "not a quasi-identifier", rationaleAr: "" },
  ],
});

describe("unattributed pii verdicts", () => {
  it("downgrades a personal verdict with no applied criterion to uncertain", async () => {
    const out = await inferPiiForAttribute(input("CASE_REMARKS"), ctx(["DIRECT_ID", "INDIRECT_ID"]), {
      infer: personalButUnattributed,
    });
    expect(out.verdict).toBe("uncertain");
    expect(out.assessments.every((a) => !a.applies)).toBe(true);
  });

  it("explains the downgrade, naming the scope that failed to cover it", async () => {
    const out = await inferPiiForAttribute(input("CASE_REMARKS"), ctx(["DIRECT_ID", "INDIRECT_ID"]), {
      infer: personalButUnattributed,
    });
    expect(out.rationaleEn).toContain("DIRECT_ID, INDIRECT_ID");
    // The engine's own reasoning survives so a steward can still see the "why".
    expect(out.rationaleEn).toContain("Free-text remarks can incidentally contain names.");
  });

  it("leaves a properly attributed pii verdict alone", async () => {
    const out = await inferPiiForAttribute(input("EMIRATES_ID"), ctx(["DIRECT_ID", "INDIRECT_ID"]), {
      infer: async () => ({
        verdict: "pii" as const,
        suggestedDataClass: "EMIRATES_ID",
        overallConfidence: 0.95,
        rationaleEn: "Emirates ID number.",
        rationaleAr: "",
        metadataConflict: false,
        criteria: [
          { code: "DIRECT_ID" as CriterionCode, applies: true, confidence: 0.95, rationaleEn: "national ID", rationaleAr: "" },
          { code: "INDIRECT_ID" as CriterionCode, applies: false, confidence: 0.1, rationaleEn: "n/a", rationaleAr: "" },
        ],
      }),
    });
    expect(out.verdict).toBe("pii");
    expect(out.assessments.find((a) => a.criterionCode === "DIRECT_ID")?.applies).toBe(true);
  });

  it("keeps the criterion when the run scope DOES cover the reason", async () => {
    // Same column, but with the wider scope the model can name its criterion.
    const out = await inferPiiForAttribute(input("CASE_REMARKS"), ctx(["DIRECT_ID", "INDIRECT_ID", "CONTEXTUAL"]), {
      infer: async () => ({
        verdict: "pii" as const,
        suggestedDataClass: null,
        overallConfidence: 0.7,
        rationaleEn: "Free-text remarks can incidentally contain names.",
        rationaleAr: "",
        metadataConflict: false,
        criteria: [
          { code: "DIRECT_ID" as CriterionCode, applies: false, confidence: 0.2, rationaleEn: "no", rationaleAr: "" },
          { code: "INDIRECT_ID" as CriterionCode, applies: false, confidence: 0.3, rationaleEn: "no", rationaleAr: "" },
          { code: "CONTEXTUAL" as CriterionCode, applies: true, confidence: 0.7, rationaleEn: "may contain names", rationaleAr: "" },
        ],
      }),
    });
    // Contextual-only is capped in confidence but stays a finding with a criterion.
    expect(out.assessments.find((a) => a.criterionCode === "CONTEXTUAL")?.applies).toBe(true);
    expect(out.verdict).not.toBe("uncertain");
  });

  it("does not disturb a not_pii verdict", async () => {
    const out = await inferPiiForAttribute(input("ROW_VERSION"), ctx(["DIRECT_ID", "INDIRECT_ID"]), {
      infer: async () => ({
        verdict: "not_pii" as const,
        suggestedDataClass: null,
        overallConfidence: 0.9,
        rationaleEn: "Row version counter.",
        rationaleAr: "",
        metadataConflict: false,
        criteria: [
          { code: "DIRECT_ID" as CriterionCode, applies: false, confidence: 0.05, rationaleEn: "no", rationaleAr: "" },
          { code: "INDIRECT_ID" as CriterionCode, applies: false, confidence: 0.05, rationaleEn: "no", rationaleAr: "" },
        ],
      }),
    });
    expect(out.verdict).toBe("not_pii");
  });
});
