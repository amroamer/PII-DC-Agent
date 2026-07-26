import { describe, expect, it } from "vitest";
import { validateDefinition } from "../../server/frameworks/routes";
import { POLICY_CRITERIA_LIST } from "@shared/lib/criteria";
import { CLASSIFICATION_LEVELS_LIST } from "@shared/lib/classification";
import { DEFAULT_CLASSIFICATION_RULES } from "../../server/classification-engine/attribute-rules";

describe("framework definition validation (save guard)", () => {
  it("accepts the canonical PII criteria set", () => {
    expect(() => validateDefinition("pii", { criteria: POLICY_CRITERIA_LIST })).not.toThrow();
  });

  it("rejects PII criteria missing a policy code", () => {
    expect(() => validateDefinition("pii", { criteria: POLICY_CRITERIA_LIST.slice(1) })).toThrow();
  });

  it("rejects a criterion with an unknown evaluationMode", () => {
    const bad = POLICY_CRITERIA_LIST.map((c, i) => (i === 0 ? { ...c, evaluationMode: "weird" } : c));
    expect(() => validateDefinition("pii", { criteria: bad })).toThrow();
  });

  it("accepts valid classification levels + rules", () => {
    expect(() =>
      validateDefinition("classification", { levels: CLASSIFICATION_LEVELS_LIST, rules: DEFAULT_CLASSIFICATION_RULES }),
    ).not.toThrow();
  });

  it("rejects a rule with an unknown (retired) level", () => {
    expect(() =>
      validateDefinition("classification", {
        levels: CLASSIFICATION_LEVELS_LIST,
        rules: [{ id: "x", verdict: "pii", level: "INTERNAL" }],
      }),
    ).toThrow();
  });

  it("rejects a rule with an unknown criterion", () => {
    expect(() =>
      validateDefinition("classification", {
        levels: CLASSIFICATION_LEVELS_LIST,
        rules: [{ id: "x", criterion: "NOPE", level: "CONFIDENTIAL" }],
      }),
    ).toThrow();
  });
});
