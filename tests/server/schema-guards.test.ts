import { describe, expect, it } from "vitest";
import { runItemDecisionSchema, classificationOverrideSchema } from "@shared/models/schema";

describe("rationale guards (P0 fix)", () => {
  it("rejects a run-item override with no rationale", () => {
    expect(runItemDecisionSchema.safeParse({ stewardDecision: "override" }).success).toBe(false);
  });

  it("accepts a run-item override that carries a rationale", () => {
    expect(runItemDecisionSchema.safeParse({ stewardDecision: "override", rationale: "steward call" }).success).toBe(true);
  });

  it("accepts accept/reject without a rationale", () => {
    expect(runItemDecisionSchema.safeParse({ stewardDecision: "accept" }).success).toBe(true);
    expect(runItemDecisionSchema.safeParse({ stewardDecision: "reject" }).success).toBe(true);
  });

  it("still requires a non-empty rationale on a classification override", () => {
    expect(
      classificationOverrideSchema.safeParse({ scope: "attribute", targetId: 1, levelCode: "SECRET", rationale: "" }).success,
    ).toBe(false);
    expect(
      classificationOverrideSchema.safeParse({ scope: "attribute", targetId: 1, levelCode: "SECRET", rationale: "why" }).success,
    ).toBe(true);
  });
});
