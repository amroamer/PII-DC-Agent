import { describe, expect, it } from "vitest";
import { orderHeaders } from "../../server/exchange/roundtrip";
import { displayPiiType } from "@shared/lib/detection-view";
import { IKC_ATTRIBUTE_FIELDS } from "@shared/lib/ikc-fields";

/**
 * The "Original file + PII" export hands the customer's own IKC workbook back
 * with its governance columns filled in, so it is re-imported into IKC. Two
 * things therefore matter more than usual: no original column may be dropped,
 * and nothing internal to PDTC may be written into an IKC field.
 */
describe("round-trip header ordering", () => {
  const canonical = IKC_ATTRIBUTE_FIELDS;

  it("emits canonical IKC headers in canonical order", () => {
    // jsonb normalises key order, so the uploaded order is gone — the canonical
    // list is what restores a sensible one.
    const raw = [{ "Column Name": "A", "Asset Id": "1", "Asset Name": "T" }];
    const out = orderHeaders(raw, canonical);
    expect(out.indexOf("Asset Id")).toBeLessThan(out.indexOf("Column Name"));
  });

  it("recognises headers through their ALIASES, not just the canonical spelling", () => {
    // Real IKC exports say "Asset Id" and "Da Type"; the canon says "Asset ID"
    // and "Data Type". Exact matching left almost every column unrecognised, so
    // canonical ordering silently did nothing.
    const raw = [{ "Da Type": "nvarchar", "Column Name": "A", "Asset Id": "1" }];
    const out = orderHeaders(raw, canonical);
    expect(out).toEqual(["Asset Id", "Column Name", "Da Type"]);
  });

  it("matches regardless of case and spacing", () => {
    const raw = [{ "column  name": "A", "ASSET ID": "1" }];
    expect(orderHeaders(raw, canonical)).toEqual(["ASSET ID", "column  name"]);
  });

  it("never drops an original header the canon does not know", () => {
    const raw = [{ "Column Name": "A", "Some Bespoke ADC Field": "x", "Another One": "y" }];
    const out = orderHeaders(raw, canonical);
    expect(out).toContain("Some Bespoke ADC Field");
    expect(out).toContain("Another One");
  });

  it("puts unknown headers after the canonical ones", () => {
    const raw = [{ "Bespoke": "x", "Column Name": "A" }];
    const out = orderHeaders(raw, canonical);
    expect(out.indexOf("Column Name")).toBeLessThan(out.indexOf("Bespoke"));
  });

  it("unions headers across rows that do not all share the same keys", () => {
    const raw = [{ "Column Name": "A" }, { "Column Name": "B", "Only On Row Two": "z" }];
    expect(orderHeaders(raw, canonical)).toContain("Only On Row Two");
  });

  it("emits each header exactly once", () => {
    const raw = [{ "Column Name": "A", "Bespoke": "x" }, { "Column Name": "B", "Bespoke": "y" }];
    const out = orderHeaders(raw, canonical);
    expect(new Set(out).size).toBe(out.length);
  });

  it("omits canonical headers absent from the source file", () => {
    // Writing empty columns the customer never had would change their schema.
    const out = orderHeaders([{ "Column Name": "A" }], canonical);
    expect(out).toEqual(["Column Name"]);
  });
});

describe("what gets written into IKC's Pii Name", () => {
  const pick = (over: Parameters<typeof displayPiiType>[0]) => displayPiiType(over) ?? "Personal Data";

  it("never writes a criterion code — that is not a PII type", () => {
    // The LLM layer routinely reports the criterion as its data class; writing
    // "DIRECT_ID" into a customer's catalog would be worse than writing nothing.
    expect(pick({ verdict: "pii", dataClassCode: "DIRECT_ID", criterion: "DIRECT_ID" })).toBe("Personal Data");
    expect(pick({ verdict: "pii", dataClassCode: "CONTEXTUAL", criterion: null })).toBe("Personal Data");
  });

  it("never writes IKC's own shape-only sentinels back to IKC", () => {
    for (const junk of ["NoClassDetected", "Text", "Code", "Date", "Indicator"]) {
      expect(pick({ verdict: "pii", selectedDataClassName: junk })).toBe("Personal Data");
    }
  });

  it("writes a real data class when there is one", () => {
    expect(pick({ verdict: "pii", selectedDataClassName: "Email Address" })).toBe("Email Address");
    expect(pick({ verdict: "pii", piiName: "Emirates ID" })).toBe("Emirates ID");
  });
});
