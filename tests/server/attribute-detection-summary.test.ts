import { describe, expect, it } from "vitest";
import { attachDetectionSummary, type SummaryDetection } from "../../server/catalog/query";

/**
 * The Data Attributes table used to render Column / Asset / Type / Classification / CDE —
 * every one of them constant across a PII-filtered catalog. These cover the fused
 * detection state that now backs the PII type / Criterion / Confidence / Why columns.
 */
const at = (iso: string) => new Date(iso);

function detection(over: Partial<SummaryDetection> & { attributeId: number }): SummaryDetection {
  return {
    runId: "run-2",
    createdAt: at("2026-08-01T10:00:00Z"),
    layer: "llm",
    verdict: "pii",
    criterionCode: "DIRECT_ID",
    dataClassCode: "EMIRATES_ID",
    confidence: 0.9,
    rationaleEn: "Column holds an Emirates ID.",
    rationaleAr: "يحتوي العمود على رقم هوية إماراتية.",
    ...over,
  };
}

describe("attachDetectionSummary", () => {
  it("attaches the fused verdict, criterion, class and rationale to a row", () => {
    const [row] = attachDetectionSummary([{ id: 1, columnName: "AADID" }], [detection({ attributeId: 1 })], []);

    expect(row).toMatchObject({
      columnName: "AADID",
      verdict: "pii",
      criterion: "DIRECT_ID",
      dataClassCode: "EMIRATES_ID",
      rationaleEn: "Column holds an Emirates ID.",
      conflict: false,
    });
    expect(row.confidence).toBeCloseTo(0.9, 5);
  });

  it("leaves never-analysed attributes null rather than inventing a verdict", () => {
    const [row] = attachDetectionSummary([{ id: 7 }], [], []);
    expect(row).toMatchObject({ verdict: null, criterion: null, confidence: null, rationaleEn: null, conflict: false });
  });

  it("ignores detections from superseded runs", () => {
    const [row] = attachDetectionSummary(
      [{ id: 1 }],
      [
        detection({ attributeId: 1, runId: "run-1", createdAt: at("2026-07-01T10:00:00Z"), verdict: "not_pii", criterionCode: null }),
        detection({ attributeId: 1, runId: "run-2", createdAt: at("2026-08-01T10:00:00Z"), verdict: "pii" }),
      ],
      [],
    );
    // A stale not_pii row must not read as a conflict against the current run.
    expect(row.verdict).toBe("pii");
    expect(row.conflict).toBe(false);
  });

  it("uses each attribute's own latest run, not one global latest", () => {
    // This catalog has been scanned in several passes. Scoping every row to the
    // newest run anywhere blanked the verdict on columns whose last analysis was
    // an earlier run — they showed up under a PII filter with an empty verdict.
    const rows = attachDetectionSummary(
      [{ id: 1 }, { id: 2 }],
      [
        detection({ attributeId: 1, runId: "run-old", createdAt: at("2026-06-01T10:00:00Z"), verdict: "pii" }),
        detection({ attributeId: 2, runId: "run-new", createdAt: at("2026-08-01T10:00:00Z"), verdict: "pii" }),
      ],
      [],
    );
    expect(rows.map((r) => r.verdict)).toEqual(["pii", "pii"]);
    expect(rows[0].rationaleEn).toBe("Column holds an Emirates ID.");
  });

  it("surfaces a genuine within-run layer disagreement as uncertain", () => {
    const [row] = attachDetectionSummary(
      [{ id: 1 }],
      [
        detection({ attributeId: 1, layer: "llm", verdict: "pii", confidence: 0.8 }),
        detection({ attributeId: 1, layer: "ikc_class", verdict: "not_pii", confidence: 0.7, criterionCode: null }),
      ],
      [],
    );
    expect(row.conflict).toBe(true);
    expect(row.verdict).toBe("uncertain");
  });

  it("keeps each attribute's detections separate", () => {
    const rows = attachDetectionSummary(
      [{ id: 1 }, { id: 2 }],
      [
        detection({ attributeId: 1, verdict: "pii", criterionCode: "DIRECT_ID" }),
        detection({ attributeId: 2, verdict: "not_pii", criterionCode: null, dataClassCode: null }),
      ],
      [],
    );
    expect(rows.map((r) => r.verdict)).toEqual(["pii", "not_pii"]);
    expect(rows[1].criterion).toBeNull();
  });

  it("reports review status, with pending outranking a resolved duplicate", () => {
    const rows = attachDetectionSummary(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      [],
      [
        { targetId: 1, status: "approved" },
        { targetId: 1, status: "pending" },
        { targetId: 2, status: "approved" },
      ],
    );
    expect(rows.map((r) => r.reviewStatus)).toEqual(["pending", "approved", null]);
  });

  it("flags PII sitting on the review threshold", () => {
    const [row] = attachDetectionSummary([{ id: 1 }], [detection({ attributeId: 1, confidence: 0.62 })], [], 0.6);
    expect(row.nearThreshold).toBe(true);
  });
});
