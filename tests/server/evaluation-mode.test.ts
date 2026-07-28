import { describe, expect, it } from "vitest";
import { CRITERION_CODES, POLICY_CRITERIA_LIST, type CriterionDef } from "@shared/lib/criteria";
import { composeSystemPrompt } from "../../server/engine/runs";
import { inferPiiForAttribute, type InferContext, type PiiAssessment } from "../../server/engine/infer";
import type { DetectionInput } from "../../server/pii-engine/types";

const BASE = "You are a PII classifier.";

describe("evaluation-mode wiring (settings → engine prompt)", () => {
  it("embeds each active criterion's evaluation mode in the composed prompt", () => {
    const prompt = composeSystemPrompt(BASE, POLICY_CRITERIA_LIST, [...CRITERION_CODES]);
    // Intrinsic criteria and contextual criteria are tagged distinctly.
    expect(prompt).toContain("DIRECT_ID (Direct Identifiability) [intrinsic]");
    expect(prompt).toContain("SPECIAL_CATEGORY (Special Categories) [intrinsic]");
    expect(prompt).toContain("INDIRECT_ID (Indirect Identifiability) [contextual]");
    expect(prompt).toContain("CONTEXTUAL (Contextual Risk) [contextual]");
    // The guide that tells the model what the two modes mean is present.
    expect(prompt).toContain("Evaluation mode (the [bracketed] tag on each criterion):");
    expect(prompt).toMatch(/intrinsic: decide it from THIS column's own metadata/);
    expect(prompt).toMatch(/contextual: it applies only through semantic judgement/);
  });

  it("flipping a criterion's mode changes the composed prompt (not a no-op)", () => {
    const before = composeSystemPrompt(BASE, POLICY_CRITERIA_LIST, [...CRITERION_CODES]);
    const flipped: CriterionDef[] = POLICY_CRITERIA_LIST.map((c) =>
      c.code === "DIRECT_ID" ? { ...c, evaluationMode: "contextual" } : c,
    );
    const after = composeSystemPrompt(BASE, flipped, [...CRITERION_CODES]);

    expect(after).not.toBe(before);
    expect(before).toContain("DIRECT_ID (Direct Identifiability) [intrinsic]");
    expect(after).toContain("DIRECT_ID (Direct Identifiability) [contextual]");
  });

  it("a mode flip changes the inference input hash → cached verdicts are invalidated", async () => {
    const input: DetectionInput = {
      attribute: {
        id: 1, assetId: 1, columnName: "national_id", descriptionEn: "d", descriptionAr: "",
        dataType: "VARCHAR", nativeType: "text", isPrimaryKey: false, nullable: true,
        selectedDataClassName: null, selectedDataClassConfidence: null, suggestedClasses: null,
        columnDataClassification: null, piiName: null, piiDescription: null, cdeFlag: false,
        rawRow: null, ingestRunId: null,
      } as unknown as DetectionInput["attribute"],
      asset: { id: 1, name: "People", assetType: "table", businessDomain: "HR", subjectArea: "Person" },
      siblingColumnNames: ["a", "b"],
    };
    const stub = async (): Promise<PiiAssessment> => ({
      verdict: "pii", suggestedDataClass: "EMIRATES_ID", overallConfidence: 0.9,
      rationaleEn: "r", rationaleAr: "ر", metadataConflict: false,
      criteria: CRITERION_CODES.map((code) => ({ code, applies: code === "DIRECT_ID", rationaleEn: "x", rationaleAr: "ي", confidence: 0.8 })),
    });
    const baseCtx: InferContext = {
      modelId: "m", promptVersion: "p@1", frameworkVersion: "fw-1", frameworkVersionId: null,
      engineVersion: "0.1.0", activeCriteria: [...CRITERION_CODES], useCache: false, forceFresh: false,
      systemPrompt: "", threshold: 0.6, seed: 42, selfConsistencySamples: 1, confidenceFloor: 0.3, includeArabic: true,
    };

    const promptA = composeSystemPrompt(BASE, POLICY_CRITERIA_LIST, [...CRITERION_CODES]);
    const promptB = composeSystemPrompt(
      BASE,
      POLICY_CRITERIA_LIST.map((c) => (c.code === "DIRECT_ID" ? { ...c, evaluationMode: "contextual" } : c)),
      [...CRITERION_CODES],
    );

    const rA = await inferPiiForAttribute(input, { ...baseCtx, systemPrompt: promptA }, { infer: stub });
    const rB = await inferPiiForAttribute(input, { ...baseCtx, systemPrompt: promptB }, { infer: stub });

    // Same column, same everything except the criterion's evaluation mode → different hash.
    expect(rA.inputHash).not.toBe(rB.inputHash);
  });
});
