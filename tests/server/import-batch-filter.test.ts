import { describe, expect, it } from "vitest";
import { ASSET_FILTERS, ATTRIBUTE_FILTERS } from "@shared/lib/filter-defs";
import { EXPORT_COLUMNS, EXPORT_PRESETS, columnByKey } from "../../server/exchange/columns";

/**
 * The catalog holds two IKC loads (an older 21k-column extract and the 5k-column
 * DHABI one). They share table-name prefixes and even table names — the duplicate
 * AADID rows come from exactly that — so nothing in the UI could tell them apart.
 * The import batch is the reliable split.
 */
describe("import batch filter", () => {
  it("is offered on the attributes screen, in the default set", () => {
    const def = ATTRIBUTE_FILTERS.find((d) => d.key === "importBatch");
    expect(def).toBeDefined();
    // Not behind "More filters" — this is the old-catalog/new-catalog switch.
    expect(def?.advanced).toBeFalsy();
    expect(def?.optionsSource).toBe("distinct");
    expect(def?.control).toBe("multiselect");
  });

  it("is offered on the assets screen too", () => {
    expect(ASSET_FILTERS.find((d) => d.key === "importBatch")).toBeDefined();
  });

  it("is not gated behind a feature-availability probe", () => {
    // Every catalog is loaded by an import, so this always has values.
    expect(ATTRIBUTE_FILTERS.find((d) => d.key === "importBatch")?.availability).toBeUndefined();
  });
});

describe("import batch in the export", () => {
  it("is an exportable column", () => {
    const col = columnByKey("importBatch");
    expect(col).toBeDefined();
    expect(col?.header).toBe("Source Import");
  });

  it("is in the steward-review preset", () => {
    // A reviewer reading the sheet must be able to tell which catalog a row is
    // from; without it, two same-named columns are indistinguishable.
    expect(EXPORT_PRESETS["steward-review"]).toContain("importBatch");
  });

  it("is in the full export", () => {
    expect(EXPORT_PRESETS["full-export"]).toContain("importBatch");
  });

  it("appears exactly once in the column set", () => {
    expect(EXPORT_COLUMNS.filter((c) => c.key === "importBatch")).toHaveLength(1);
  });
});
