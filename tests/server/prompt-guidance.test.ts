import { describe, expect, it } from "vitest";
import { SEED_PROMPTS } from "../../server/seed-data";
import { composeSystemPrompt } from "../../server/engine/runs";
import { CRITERION_CODES, POLICY_CRITERIA_LIST } from "@shared/lib/criteria";

/**
 * Regression guard for the guidance the engine relies on. It does NOT measure model
 * accuracy (that needs the live eval harness — see script/eval-classification.ts) but it
 * locks the key clauses so a careless prompt edit can't silently drop them, which would
 * quietly change classification behaviour.
 */
describe("PII detection prompt guidance", () => {
  it("carries the evaluation-mode guide and per-criterion mode tags", () => {
    const prompt = composeSystemPrompt("BASE", POLICY_CRITERIA_LIST, [...CRITERION_CODES]);
    expect(prompt).toContain("Evaluation mode (the [bracketed] tag on each criterion):");
    expect(prompt).toMatch(/intrinsic: decide it from THIS column's own metadata/);
    expect(prompt).toMatch(/contextual: it applies only through semantic judgement/);
    expect(prompt).toContain("DIRECT_ID (Direct Identifiability) [intrinsic]");
  });
});

describe("classification prompt §8.2 guidance", () => {
  const prompt = SEED_PROMPTS.find((p) => p.key === "classification_classify")?.content ?? "";

  it("exists and names the confidentiality scale", () => {
    expect(prompt).not.toBe("");
    expect(prompt).toContain("OPEN < CONFIDENTIAL < SENSITIVE < SECRET");
  });

  it("keeps the SECRET credentials rule (access credentials → Secret)", () => {
    expect(prompt).toMatch(/passwords/i);
    expect(prompt).toMatch(/(private|secret|API|encryption)\s*\/?\s*.*keys?/i);
    expect(prompt).toMatch(/tokens?/i);
  });

  it("keeps the SENSITIVE non-personal rule (trade secrets / source code → Sensitive)", () => {
    expect(prompt).toMatch(/trade secrets/i);
    expect(prompt).toMatch(/source code/i);
    expect(prompt).toMatch(/proprietary/i);
  });
});
