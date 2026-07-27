import { describe, expect, it } from "vitest";
import { CRITERION_CODES } from "@shared/lib/criteria";
import {
  inferPiiForAttribute,
  type InferContext,
  type InferDeps,
  type PiiAssessment,
} from "../../server/engine/infer";
import type { DetectionInput } from "../../server/pii-engine/types";

function makeInput(i: number): DetectionInput {
  return {
    attribute: {
      id: i,
      assetId: 1,
      columnName: `col_${i}`,
      descriptionEn: `desc ${i}`,
      descriptionAr: "",
      dataType: "VARCHAR",
      nativeType: "text",
      isPrimaryKey: false,
      nullable: true,
      selectedDataClassName: null,
      selectedDataClassConfidence: null,
      suggestedClasses: null,
      columnDataClassification: null,
      piiName: null,
      piiDescription: null,
      cdeFlag: false,
      rawRow: null,
      ingestRunId: null,
    } as unknown as DetectionInput["attribute"],
    asset: { id: 1, name: "Travellers", assetType: "table", businessDomain: "Border", subjectArea: "Traveller" },
    siblingColumnNames: ["a", "b"],
  };
}

const ctx: InferContext = {
  modelId: "test-model",
  promptVersion: "p@1",
  frameworkVersion: "pii-1.0",
  frameworkVersionId: null,
  engineVersion: "0.1.0",
  activeCriteria: [...CRITERION_CODES],
  useCache: false,
  forceFresh: false,
  systemPrompt: "sys",
  threshold: 0.6,
  seed: 42,
  selfConsistencySamples: 1,
  confidenceFloor: 0.3,
  includeArabic: true,
};

const stub = async (): Promise<PiiAssessment> => ({
  verdict: "pii",
  suggestedDataClass: "EMIRATES_ID",
  overallConfidence: 0.9,
  rationaleEn: "reason",
  rationaleAr: "سبب",
  metadataConflict: false,
  criteria: CRITERION_CODES.map((code) => ({
    code,
    applies: code === "DIRECT_ID",
    rationaleEn: "x",
    rationaleAr: "ي",
    confidence: 0.8,
  })),
});

describe("engine determinism (§7.1)", () => {
  it("produces identical output + inputHash across two runs over 20 attributes", async () => {
    const inputs = Array.from({ length: 20 }, (_, i) => makeInput(i));
    const runA = await Promise.all(inputs.map((inp) => inferPiiForAttribute(inp, ctx, { infer: stub })));
    const runB = await Promise.all(inputs.map((inp) => inferPiiForAttribute(inp, ctx, { infer: stub })));

    for (let i = 0; i < inputs.length; i++) {
      expect(runB[i].inputHash).toBe(runA[i].inputHash);
      expect(runB[i].verdict).toBe(runA[i].verdict);
      expect(runB[i].assessments).toEqual(runA[i].assessments);
    }
    // hashes are unique per distinct attribute
    expect(new Set(runA.map((r) => r.inputHash)).size).toBe(20);
  });

  it("emits exactly one assessment per active criterion (§13.10)", async () => {
    const r = await inferPiiForAttribute(makeInput(1), ctx, { infer: stub });
    expect(r.assessments).toHaveLength(CRITERION_CODES.length);
    expect(new Set(r.assessments.map((a) => a.criterionCode)).size).toBe(CRITERION_CODES.length);
  });

  it("self-consistency divergence forces an uncertain verdict (§7.4)", async () => {
    // Even seeds say pii, odd seeds say not_pii -> not unanimous -> uncertain.
    const divergent: InferDeps["infer"] = async (_p, _s, seed) => ({
      ...(await stub()),
      verdict: (seed ?? 0) % 2 === 0 ? "pii" : "not_pii",
    });
    const ctx3: InferContext = { ...ctx, selfConsistencySamples: 3, useCache: false };
    const r = await inferPiiForAttribute(makeInput(3), ctx3, { infer: divergent });
    expect(r.verdict).toBe("uncertain");
  });

  it("cache returns stored response and issues zero LLM calls on the second run (§13.3)", async () => {
    const store = new Map<string, Record<string, unknown>>();
    let calls = 0;
    const deps: InferDeps = {
      infer: async () => {
        calls++;
        return stub();
      },
      getCached: async (h) => store.get(h),
      putCache: async (h, r) => {
        store.set(h, r);
      },
    };
    const cachedCtx: InferContext = { ...ctx, useCache: true };
    const input = makeInput(7);

    const first = await inferPiiForAttribute(input, cachedCtx, deps);
    const second = await inferPiiForAttribute(input, cachedCtx, deps);

    expect(calls).toBe(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.verdict).toBe(first.verdict);
    expect(second.assessments).toEqual(first.assessments);
  });
});
