import { describe, expect, it } from "vitest";
import {
  inferClassificationLevel,
  type ClassAssessment,
  type ClassInferContext,
  type ClassInferDeps,
  type PiiContext,
} from "../../server/classification-engine/classify-infer";
import { reconcileLevel, reconciliationNote } from "../../server/classification-engine/attribute-rules";
import type { DetectionInput } from "../../server/pii-engine/types";

function makeInput(i: number, asset = "Travellers"): DetectionInput {
  return {
    attribute: {
      id: i,
      assetId: 1,
      columnName: `col_${i}`,
      descriptionEn: `desc ${i}`,
      descriptionAr: "",
      dataType: "VARCHAR",
      nativeType: "text",
    } as unknown as DetectionInput["attribute"],
    asset: { id: 1, name: asset, assetType: "table", businessDomain: "Border", subjectArea: "Traveller" },
    siblingColumnNames: ["a", "b"],
  };
}

const ctx: ClassInferContext = {
  modelId: "test-model",
  promptVersion: "class@1",
  frameworkVersion: "class-1.0",
  frameworkVersionId: null,
  engineVersion: "0.1.0",
  useCache: false,
  forceFresh: false,
  systemPrompt: "sys",
  seed: 42,
  includeArabic: true,
};

const pii: PiiContext = { verdict: "pii", criterion: "DIRECT_ID", isSpecialCategory: false };

const stub = (level: ClassAssessment["level"] = "SECRET"): ClassInferDeps["infer"] =>
  async () => ({ level, confidence: 0.9, rationaleEn: "reason", rationaleAr: "سبب", signals: ["s"] });

describe("reconcileLevel — escalate-only", () => {
  it("raises the floor when the LLM says a higher level", () => {
    expect(reconcileLevel("SECRET", "CONFIDENTIAL")).toBe("SECRET");
    expect(reconcileLevel("SENSITIVE", "CONFIDENTIAL")).toBe("SENSITIVE");
  });

  it("never lowers below the governance floor", () => {
    expect(reconcileLevel("OPEN", "CONFIDENTIAL")).toBe("CONFIDENTIAL");
    expect(reconcileLevel("CONFIDENTIAL", "SENSITIVE")).toBe("SENSITIVE");
  });

  it("falls back to the floor when the LLM is unavailable (null)", () => {
    expect(reconcileLevel(null, "CONFIDENTIAL")).toBe("CONFIDENTIAL");
    expect(reconcileLevel(null, "SENSITIVE")).toBe("SENSITIVE");
  });
});

describe("reconciliationNote", () => {
  it("is empty when the model and final levels agree", () => {
    expect(reconciliationNote("CONFIDENTIAL", "CONFIDENTIAL", null, true)).toEqual({ en: "", ar: "" });
    expect(reconciliationNote(null, "CONFIDENTIAL", null, true).en).toBe("");
  });

  it("attributes a raise to the existing catalog classification when it is the binding floor", () => {
    const n = reconciliationNote("CONFIDENTIAL", "SENSITIVE", "SENSITIVE", true);
    expect(n.en).toContain("existing catalog classification");
    expect(n.en).toContain("Sensitive");
    expect(n.ar).not.toBe("");
  });

  it("attributes a raise to the policy floor when there is no higher existing level", () => {
    const n = reconciliationNote("CONFIDENTIAL", "SENSITIVE", null, true);
    expect(n.en).toContain("policy floor");
  });

  it("omits Arabic when includeArabic is false", () => {
    expect(reconciliationNote("CONFIDENTIAL", "SECRET", null, false).ar).toBe("");
  });
});

describe("inferClassificationLevel", () => {
  it("returns the model level and a stable inputHash across runs", async () => {
    const a = await inferClassificationLevel(makeInput(1), pii, ctx, { infer: stub("SECRET") });
    const b = await inferClassificationLevel(makeInput(1), pii, ctx, { infer: stub("SECRET") });
    expect(a.level).toBe("SECRET");
    expect(b.inputHash).toBe(a.inputHash);
  });

  it("changes the inputHash when the PII context changes", async () => {
    const a = await inferClassificationLevel(makeInput(2), pii, ctx, { infer: stub() });
    const b = await inferClassificationLevel(
      makeInput(2),
      { ...pii, isSpecialCategory: true },
      ctx,
      { infer: stub() },
    );
    expect(b.inputHash).not.toBe(a.inputHash);
  });

  it("degrades to level=null when no LLM is available", async () => {
    // No injected infer and AI unconfigured in the test env -> layer skipped.
    const r = await inferClassificationLevel(makeInput(3), pii, ctx, {});
    expect(r.level).toBeNull();
  });

  it("cache returns the stored level and issues zero LLM calls on the second run", async () => {
    const store = new Map<string, Record<string, unknown>>();
    let calls = 0;
    const deps: ClassInferDeps = {
      infer: async () => {
        calls++;
        return { level: "SENSITIVE", confidence: 0.8, rationaleEn: "r", rationaleAr: "ر", signals: [] };
      },
      getCached: async (h) => store.get(h),
      putCache: async (h, r) => {
        store.set(h, r);
      },
    };
    const cachedCtx: ClassInferContext = { ...ctx, useCache: true };
    const input = makeInput(7);

    const first = await inferClassificationLevel(input, pii, cachedCtx, deps);
    const second = await inferClassificationLevel(input, pii, cachedCtx, deps);

    expect(calls).toBe(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.level).toBe(first.level);
  });
});
