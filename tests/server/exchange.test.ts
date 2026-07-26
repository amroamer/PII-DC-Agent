import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { computeRowDiffs, type CurrentCatalogRow } from "../../server/exchange/import";
import { generateWorkbook, type ExportRow } from "../../server/exchange/export";

const current: CurrentCatalogRow = {
  piiName: "PII",
  columnDataClassification: "CONFIDENTIAL",
  columnName: "email",
  dataType: "VARCHAR",
  selectedDataClassName: "EMAIL",
};

describe("round-trip diff (§13.8)", () => {
  it("reports exactly the mutated editable field and nothing else", () => {
    const sheet = {
      "PII Decision": "Yes", // == current (piiName present) -> no diff
      "Classification Decision": "SECRET", // CONFIDENTIAL -> SECRET -> one diff
      "Column Name": "email", // read-only, unchanged
      "Data Type": "VARCHAR", // read-only, unchanged
    };
    const { diffs, readOnlyWarnings } = computeRowDiffs(sheet, current);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe("classification_decision");
    expect(diffs[0].incomingValue).toBe("SECRET");
    expect(readOnlyWarnings).toBe(0);
  });
});

describe("field-cleared detection (P0 fix)", () => {
  it("flags a blanked editable cell that previously carried a tag as 'cleared'", () => {
    const sheet = { "PII Decision": "", "Classification Decision": "" };
    const { diffs } = computeRowDiffs(sheet, current);
    // piiName present -> clearing it is a diff; classification CONFIDENTIAL -> clearing is a diff.
    expect(diffs.map((d) => d.changeType).sort()).toEqual(["cleared", "cleared"]);
  });

  it("does not flag a blank cell when there was nothing to clear", () => {
    const empty: CurrentCatalogRow = { piiName: null, columnDataClassification: null, columnName: "x", dataType: null, selectedDataClassName: null };
    const { diffs } = computeRowDiffs({ "PII Decision": "", "Classification Decision": "" }, empty);
    expect(diffs).toHaveLength(0);
  });
});

describe("read-only enforcement (§13.9)", () => {
  it("counts a read-only column change as a warning and produces no diff for it", () => {
    const sheet = {
      "Classification Decision": "CONFIDENTIAL", // == current -> no diff
      "Data Type": "CHANGED", // read-only mutated -> warning, ignored
    };
    const { diffs, readOnlyWarnings } = computeRowDiffs(sheet, current);
    expect(diffs).toHaveLength(0);
    expect(readOnlyWarnings).toBe(1);
  });
});

describe("workbook fidelity", () => {
  it("writes and reads back editable columns + hidden _row_key", async () => {
    const rows: ExportRow[] = [
      {
        _row_key: "abc123",
        ikcAssetId: "A1",
        assetName: "Travellers",
        columnName: "email",
        pii_decision: "Yes",
        classification_decision: "CONFIDENTIAL",
      },
    ];
    const buffer = await generateWorkbook(rows, ["ikcAssetId", "assetName", "columnName", "pii_decision", "classification_decision"], 42, { exportedBy: "tester" });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Attributes")!;
    // xlsx stores header labels (not the runtime column keys), so look up by header.
    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell, col) => (headers[col] = String(cell.value)));
    const dataRow = sheet.getRow(2);
    const getByHeader = (header: string) => {
      const idx = headers.indexOf(header);
      return idx > 0 ? String(dataRow.getCell(idx).value) : undefined;
    };
    expect(getByHeader("Classification Decision")).toBe("CONFIDENTIAL");
    expect(getByHeader("PII Decision")).toBe("Yes");
    expect(getByHeader("_row_key")).toBe("abc123");
    expect(wb.getWorksheet("README")).toBeTruthy();
  });
});
