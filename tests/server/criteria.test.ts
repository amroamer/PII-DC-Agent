import { describe, expect, it } from "vitest";
import { criterionForDataClass } from "../../server/pii-engine/criteria";
import {
  classifyByRules,
  DEFAULT_CLASSIFICATION_RULES,
} from "../../server/classification-engine/attribute-rules";
import type { CachedDataClass } from "../../server/reference-cache";

function dataClass(overrides: Partial<CachedDataClass>): CachedDataClass {
  return {
    code: "TEST",
    nameEn: "Test",
    nameAr: "اختبار",
    category: "test",
    isPii: false,
    isSpecialCategory: false,
    detectionHints: [],
    source: "ikc",
    active: true,
    ...overrides,
  };
}

describe("criterion mapping (intrinsic layers)", () => {
  it("maps a special-category class to SPECIAL_CATEGORY", () => {
    expect(criterionForDataClass(dataClass({ isPii: true, isSpecialCategory: true }))).toBe(
      "SPECIAL_CATEGORY",
    );
  });

  it("maps a plain PII class to DIRECT_ID", () => {
    expect(criterionForDataClass(dataClass({ isPii: true }))).toBe("DIRECT_ID");
  });

  it("maps a non-PII class to null", () => {
    expect(criterionForDataClass(dataClass({ isPii: false }))).toBeNull();
  });
});

describe("classification rule table (first-match-wins)", () => {
  it("classifies special category as SECRET regardless of criterion", () => {
    const result = classifyByRules(
      { verdict: "pii", criterion: "DIRECT_ID", isSpecialCategory: true, existingLevel: null },
      DEFAULT_CLASSIFICATION_RULES,
    );
    expect(result.level).toBe("SECRET");
  });

  it("classifies a direct identifier as CONFIDENTIAL", () => {
    const result = classifyByRules(
      { verdict: "pii", criterion: "DIRECT_ID", isSpecialCategory: false, existingLevel: null },
      DEFAULT_CLASSIFICATION_RULES,
    );
    expect(result.level).toBe("CONFIDENTIAL");
  });

  it("classifies non-PII as PUBLIC", () => {
    const result = classifyByRules(
      { verdict: "not_pii", criterion: null, isSpecialCategory: false, existingLevel: null },
      DEFAULT_CLASSIFICATION_RULES,
    );
    expect(result.level).toBe("PUBLIC");
  });

  it("never downgrades below the existing IKC classification floor", () => {
    const result = classifyByRules(
      { verdict: "not_pii", criterion: null, isSpecialCategory: false, existingLevel: "CONFIDENTIAL" },
      DEFAULT_CLASSIFICATION_RULES,
    );
    expect(result.level).toBe("CONFIDENTIAL");
  });
});
