import { describe, expect, it } from "vitest";
import {
  attentionRank,
  compareByAttention,
  displayDataClass,
  displayPiiType,
  isConfidenceNotable,
  layerSummary,
  oneLine,
  type AttentionInput,
} from "@shared/lib/detection-view";

const row = (over: Partial<AttentionInput>): AttentionInput => ({
  verdict: "not_pii",
  confidence: 0.99,
  conflict: false,
  nearThreshold: false,
  ...over,
});

describe("attention ordering", () => {
  it("ranks conflicts above every other row", () => {
    expect(attentionRank(row({ verdict: "pii", conflict: true }))).toBeLessThan(attentionRank(row({ verdict: "uncertain" })));
  });

  it("ranks uncertain, near-threshold PII, PII, then not-PII", () => {
    const ranks = [
      attentionRank(row({ verdict: "uncertain" })),
      attentionRank(row({ verdict: "pii", nearThreshold: true })),
      attentionRank(row({ verdict: "pii" })),
      attentionRank(row({ verdict: "not_pii" })),
    ];
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(4);
  });

  it("no longer leads with 99%-confident not-PII rows", () => {
    // The exact regression from the screenshots: confidence-descending buried
    // every actionable row under a screen of certain negatives.
    const sorted = [
      row({ verdict: "not_pii", confidence: 0.99 }),
      row({ verdict: "pii", confidence: 0.72 }),
      row({ verdict: "uncertain", confidence: 0.55 }),
      row({ verdict: "pii", confidence: 0.9, conflict: true }),
    ].sort(compareByAttention);

    expect(sorted.map((r) => [r.verdict, r.conflict])).toEqual([
      ["pii", true],
      ["uncertain", false],
      ["pii", false],
      ["not_pii", false],
    ]);
  });

  it("puts the strongest findings first within PII, weakest first within not-PII", () => {
    const pii = [row({ verdict: "pii", confidence: 0.7 }), row({ verdict: "pii", confidence: 0.95 })].sort(compareByAttention);
    expect(pii.map((r) => r.confidence)).toEqual([0.95, 0.7]);

    const notPii = [row({ confidence: 0.99 }), row({ confidence: 0.65 })].sort(compareByAttention);
    expect(notPii.map((r) => r.confidence)).toEqual([0.65, 0.99]);
  });
});

describe("layerSummary", () => {
  it("flags the layer that voted against the merged verdict", () => {
    const entries = layerSummary(
      [
        { layer: "llm", verdict: "not_pii", confidence: 0.9 },
        { layer: "ikc_class", verdict: "pii", confidence: 0.8 },
      ],
      "pii",
    );
    expect(entries.map((e) => [e.label, e.agrees])).toEqual([
      ["IKC", true],
      ["LLM", false],
    ]);
  });

  it("collapses repeat rows from one layer to its highest-confidence signal", () => {
    const entries = layerSummary(
      [
        { layer: "llm", verdict: "not_pii", confidence: 0.4 },
        { layer: "llm", verdict: "pii", confidence: 0.85 },
      ],
      "pii",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ verdict: "pii", confidence: 0.85, agrees: true });
  });

  it("returns entries in canonical layer order regardless of input order", () => {
    const entries = layerSummary(
      [
        { layer: "llm", verdict: "pii", confidence: 0.9 },
        { layer: "adc_class", verdict: "pii", confidence: 0.9 },
        { layer: "ikc_class", verdict: "pii", confidence: 0.9 },
      ],
      "pii",
    );
    expect(entries.map((e) => e.layer)).toEqual(["ikc_class", "adc_class", "llm"]);
  });
});

describe("isConfidenceNotable", () => {
  it("is false for the uniform high-confidence rows that made the column noise", () => {
    expect(isConfidenceNotable(row({ confidence: 0.99 }))).toBe(false);
  });

  it("is true for conflicts, uncertain rows and anything near the threshold", () => {
    expect(isConfidenceNotable(row({ verdict: "pii", conflict: true }))).toBe(true);
    expect(isConfidenceNotable(row({ verdict: "uncertain" }))).toBe(true);
    expect(isConfidenceNotable(row({ verdict: "pii", nearThreshold: true }))).toBe(true);
    expect(isConfidenceNotable(row({ verdict: "pii", confidence: 0.62 }))).toBe(true);
  });
});

describe("displayDataClass", () => {
  it("drops a data class that only echoes the criterion badge next to it", () => {
    expect(displayDataClass({ dataClassCode: "DIRECT_ID", criterion: "DIRECT_ID" })).toBeNull();
    // The LLM layer also emits a criterion code with no criterion recorded at all.
    expect(displayDataClass({ dataClassCode: "CONTEXTUAL", criterion: null })).toBeNull();
  });

  it("keeps a real data class", () => {
    expect(displayDataClass({ dataClassCode: "EMIRATES_ID", criterion: "DIRECT_ID" })).toBe("EMIRATES_ID");
  });

  it("returns null when there is no data class", () => {
    expect(displayDataClass({ dataClassCode: null, criterion: "DIRECT_ID" })).toBeNull();
  });
});

describe("displayPiiType", () => {
  it("suppresses the sentinel IKC class that covers most of the catalog", () => {
    expect(displayPiiType({ verdict: "pii", selectedDataClassName: "NoClassDetected" })).toBeNull();
  });

  it("suppresses shape-only IKC classes that say nothing about personal data", () => {
    for (const generic of ["Text", "Date", "Code", "Indicator", "Boolean", "Identifier"]) {
      expect(displayPiiType({ verdict: "pii", selectedDataClassName: generic })).toBeNull();
    }
  });

  it("keeps an IKC class that names what the column holds", () => {
    expect(displayPiiType({ verdict: "pii", selectedDataClassName: "Email Address" })).toBe("Email Address");
  });

  it("does not pair a data class with a Not Personal verdict", () => {
    // The engine emits a class alongside negative verdicts; showing both in one
    // row read as a contradiction.
    expect(displayPiiType({ verdict: "not_pii", dataClassCode: "EMIRATES_ID", selectedDataClassName: "Email Address" })).toBeNull();
  });

  it("prefers the curated PII name over either engine or IKC class", () => {
    expect(
      displayPiiType({ verdict: "pii", piiName: "Emirates ID", dataClassCode: "EMIRATES_ID", selectedDataClassName: "Text" }),
    ).toBe("Emirates ID");
  });

  it("falls back to the IKC class for a column no run has analysed", () => {
    expect(displayPiiType({ verdict: null, selectedDataClassName: "Person Name" })).toBe("Person Name");
  });
});

describe("oneLine", () => {
  it("collapses newlines and padding so a rationale fits a table cell", () => {
    expect(oneLine("  Matches the\n  Emirates ID  pattern.\t")).toBe("Matches the Emirates ID pattern.");
  });

  it("returns an empty string for missing text", () => {
    expect(oneLine(null)).toBe("");
    expect(oneLine(undefined)).toBe("");
  });
});
