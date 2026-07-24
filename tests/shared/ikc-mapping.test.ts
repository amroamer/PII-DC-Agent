import { describe, expect, it } from "vitest";
import { autoMapColumns } from "@shared/lib/ikc-fields";

describe("IKC column auto-mapping", () => {
  it("maps canonical attribute fields from exact and alias headers", () => {
    const headers = ["Asset ID", "Column Name", "Data Type", "Data Class", "PII"];
    const mapping = autoMapColumns(headers, "attribute");
    expect(mapping.ikcAssetId).toBe("Asset ID");
    expect(mapping.columnName).toBe("Column Name");
    expect(mapping.dataType).toBe("Data Type");
    expect(mapping.selectedDataClassName).toBe("Data Class");
    expect(mapping.piiName).toBe("PII");
  });

  it("tolerates spelling/spacing variants via aliases and normalisation", () => {
    const headers = ["table_id", "Attribute Name", "Physical Type"];
    const mapping = autoMapColumns(headers, "attribute");
    expect(mapping.ikcAssetId).toBe("table_id");
    expect(mapping.columnName).toBe("Attribute Name");
    expect(mapping.nativeType).toBe("Physical Type");
  });

  it("leaves unmatched canonical fields null", () => {
    const mapping = autoMapColumns(["Totally Unrelated"], "asset");
    expect(mapping.name).toBeNull();
    expect(mapping.ikcAssetId).toBeNull();
  });
});
