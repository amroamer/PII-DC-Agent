import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { autoMapColumns } from "@shared/lib/ikc-fields";
import type { Asset, Attribute } from "@shared/models/schema";
import { parseTwoSheetWorkbook, asList, asClassNames } from "../../server/ingest/parse";
import { buildAssetOps, buildAttributeOps, valuesEqual } from "../../server/ingest/diff";

/** Build a two-sheet .xlsx buffer from arrays-of-arrays. */
function makeWorkbook(assetAoa: unknown[][], columnAoa: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(assetAoa), "Asset");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(columnAoa), "Columns");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const asset = (partial: Partial<Asset>): Asset => ({ id: 1, ikcAssetId: "A1", name: "A1", piiFlag: false, cdeFlag: false, ...partial } as Asset);
const attr = (partial: Partial<Attribute>): Attribute =>
  ({ id: 1, assetId: 1, columnName: "col", isPrimaryKey: false, nullable: true, cdeFlag: false, ...partial } as Attribute);

describe("parseTwoSheetWorkbook", () => {
  it("reads the Asset and Columns sheets by name", () => {
    const buffer = makeWorkbook(
      [["Asset Id", "Name", "Retention Period"], ["A1", "Customers", "10 Years"]],
      [["Asset Id", "Column Name", "Da Type"], ["A1", "email", "varchar"]],
    );
    const sheets = parseTwoSheetWorkbook(buffer);
    expect(sheets.sheetNames).toEqual(["Asset", "Columns"]);
    expect(sheets.assetSheet?.headers).toEqual(["Asset Id", "Name", "Retention Period"]);
    expect(sheets.columnSheet?.headers).toEqual(["Asset Id", "Column Name", "Da Type"]);
    expect(sheets.assetSheet?.rows).toHaveLength(1);
    expect(sheets.columnSheet?.rows).toHaveLength(1);
  });
});

describe("buildAssetOps", () => {
  const headers = ["Asset Id", "Name", "Retention Period", "Pii", "Quality Score"];
  const mapping = autoMapColumns(headers, "asset");
  const row = (over: Record<string, unknown> = {}) => ({
    "Asset Id": "A1",
    Name: "Customers",
    "Retention Period": "10 Years",
    Pii: "",
    "Quality Score": "99.8",
    ...over,
  });

  it("marks an unseen asset as new", () => {
    const { ops, counts } = buildAssetOps([row()], mapping, []);
    expect(counts).toMatchObject({ new: 1, changed: 0, unchanged: 0 });
    expect(ops[0].status).toBe("new");
    expect(ops[0].values).toMatchObject({ ikcAssetId: "A1", name: "Customers", retentionPeriod: "10 Years" });
  });

  it("is idempotent — re-uploading identical data yields no changes", () => {
    const existing = [asset({ retentionPeriod: "10 Years", qualityScore: 99.8, name: "Customers" })];
    const { ops, counts } = buildAssetOps([row()], mapping, existing);
    expect(counts).toMatchObject({ new: 0, changed: 0, unchanged: 1 });
    expect(ops[0].changes).toHaveLength(0);
  });

  it("reports ONLY the field that actually changed", () => {
    const existing = [asset({ retentionPeriod: "10 Years", qualityScore: 99.8, name: "Customers" })];
    const { ops, counts } = buildAssetOps([row({ "Retention Period": "15 Years" })], mapping, existing);
    expect(counts.changed).toBe(1);
    expect(ops[0].changes).toHaveLength(1);
    expect(ops[0].changes[0]).toMatchObject({ field: "retentionPeriod", from: "10 Years", to: "15 Years" });
    expect(ops[0].values).toEqual({ retentionPeriod: "15 Years" });
  });

  it("never clears an existing value from a blank cell", () => {
    const existing = [asset({ retentionPeriod: "10 Years", piiFlag: true, qualityScore: 99.8, name: "Customers" })];
    // Retention blank + Pii blank must not downgrade retention or the PII flag.
    const { ops, counts } = buildAssetOps([row({ "Retention Period": "", Pii: "" })], mapping, existing);
    expect(counts.unchanged).toBe(1);
    expect(ops[0].changes).toHaveLength(0);
  });

  it("absorbs float round-trip drift in quality scores (no spurious change)", () => {
    const existing = [asset({ retentionPeriod: "10 Years", qualityScore: 99.81685, name: "Customers" })];
    const { counts } = buildAssetOps([row({ "Quality Score": "99.81685185185185" })], mapping, existing);
    expect(counts.changed).toBe(0);
  });
});

describe("buildAttributeOps", () => {
  const headers = ["Asset Id", "Asset Name", "Column Name", "Da Type", "Column Data Classification"];
  const mapping = autoMapColumns(headers, "attribute");
  const row = (over: Record<string, unknown> = {}) => ({
    "Asset Id": "A1",
    "Asset Name": "Customers",
    "Column Name": "email",
    "Da Type": "varchar",
    "Column Data Classification": "Confidential",
    ...over,
  });

  it("does not duplicate an existing column on re-upload", () => {
    const existing = new Map<string, Attribute>([
      ["A1::email", attr({ columnName: "email", dataType: "varchar", columnDataClassification: "CONFIDENTIAL" })],
    ]);
    const { ops, counts } = buildAttributeOps([row()], mapping, existing);
    expect(counts).toMatchObject({ new: 0, changed: 0, unchanged: 1 });
    expect(ops[0].status).toBe("unchanged");
  });

  it("marks an unmatched column as new", () => {
    const { ops, counts } = buildAttributeOps([row({ "Column Name": "phone" })], mapping, new Map());
    expect(counts.new).toBe(1);
    expect(ops[0].status).toBe("new");
    expect(ops[0].columnName).toBe("phone");
  });

  it("reports only the changed column field", () => {
    const existing = new Map<string, Attribute>([
      ["A1::email", attr({ columnName: "email", dataType: "varchar", columnDataClassification: "CONFIDENTIAL" })],
    ]);
    const { ops, counts } = buildAttributeOps([row({ "Da Type": "char" })], mapping, existing);
    expect(counts.changed).toBe(1);
    expect(ops[0].changes).toHaveLength(1);
    expect(ops[0].changes[0]).toMatchObject({ field: "dataType", from: "varchar", to: "char" });
  });
});

describe("valuesEqual", () => {
  it("treats a missing stored value as unequal", () => {
    expect(valuesEqual("x", null)).toBe(false);
    expect(valuesEqual(true, null)).toBe(false);
  });
  it("compares arrays by content", () => {
    expect(valuesEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(valuesEqual(["a"], ["a", "b"])).toBe(false);
  });
  it("tolerates tiny float drift", () => {
    expect(valuesEqual(99.81685185, 99.81685)).toBe(true);
    expect(valuesEqual(99.8, 88.8)).toBe(false);
  });
});

describe("asList (IKC list-literal parsing)", () => {
  it("unwraps single- and multi-element Python lists", () => {
    expect(asList("['Analytical']")).toEqual(["Analytical"]);
    expect(asList("['Declaration Management', 'Risk Management']")).toEqual(["Declaration Management", "Risk Management"]);
  });
  it("parses JSON arrays too", () => {
    expect(asList('["a","b"]')).toEqual(["a", "b"]);
  });
  it("collapses literal Python-repr \\t/\\n escapes and real whitespace, trims each element", () => {
    // Real control chars…
    expect(asList("['Finance\tFinancial - Revenue']")).toEqual(["Finance Financial - Revenue"]);
    // …and the LITERAL two-char escapes IKC actually exports.
    expect(asList("['Finance\\tFinancial - Revenue']")).toEqual(["Finance Financial - Revenue"]);
    expect(asList("['Customs Audit\\n']")).toEqual(["Customs Audit"]);
    expect(asList("['Declaration Management\\n', 'Risk Management']")).toEqual(["Declaration Management", "Risk Management"]);
    expect(asList("['Equipment', ' Declaration', 'Party']")).toEqual(["Equipment", "Declaration", "Party"]);
  });
  it("splits a plain delimited string and de-dupes (order-preserving)", () => {
    expect(asList("a; b; a")).toEqual(["a", "b"]);
  });
  it("returns null for empty / blank / empty-list input", () => {
    expect(asList("[]")).toBeNull();
    expect(asList("")).toBeNull();
    expect(asList(null)).toBeNull();
  });
});

describe("asClassNames (IKC suggested-classes JSON)", () => {
  it("extracts the class names from the object array", () => {
    expect(asClassNames('[{"id":"U","name":"NoClassDetected","confidence":1}]')).toEqual(["NoClassDetected"]);
    expect(asClassNames('[{"name":"Airport Code","confidence":0.9},{"name":"Date","confidence":0.5}]')).toEqual(["Airport Code", "Date"]);
  });
  it("de-dupes repeated names and drops empties", () => {
    expect(asClassNames('[{"name":"Code"},{"name":"Code"},{"name":""}]')).toEqual(["Code"]);
  });
  it("returns null for an empty array and falls back to list parsing for non-JSON", () => {
    expect(asClassNames("[]")).toBeNull();
    expect(asClassNames("Code; Text")).toEqual(["Code", "Text"]);
  });
});

describe("buildAssetOps — list-shaped facets", () => {
  const headers = ["Asset Id", "Name", "Business Domain"];
  const mapping = autoMapColumns(headers, "asset");
  const row = (over: Record<string, unknown> = {}) => ({ "Asset Id": "A1", Name: "Customers", "Business Domain": "['Analytical']", ...over });

  it("parses a Python-list business domain into a string[] value", () => {
    const { ops } = buildAssetOps([row()], mapping, []);
    expect(ops[0].values.businessDomain).toEqual(["Analytical"]);
  });

  it("is idempotent when the stored array already equals the parsed value", () => {
    const existing = [asset({ name: "Customers", businessDomain: ["Analytical"] })];
    const { counts } = buildAssetOps([row()], mapping, existing);
    expect(counts.unchanged).toBe(1);
  });
});
