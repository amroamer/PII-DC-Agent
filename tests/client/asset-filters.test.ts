import { describe, expect, it } from "vitest";
import { ASSET_FILTERS, ATTRIBUTE_FILTERS } from "@shared/lib/filter-defs";

/**
 * The assets screen carried ~34 filters with no default/advanced split. Once the
 * panel stopped rendering group headers for small sets, that screen became a
 * single undifferentiated wall of 29 controls with no way to collapse it — so it
 * gets the same treatment the attributes screen already had.
 */
describe("asset filters", () => {
  const defaults = ASSET_FILTERS.filter((d) => !d.advanced);

  it("has a default set small enough to read at a glance", () => {
    expect(defaults.length).toBeLessThanOrEqual(13);
  });

  it("leads with the filters an asset screen is actually used for", () => {
    const keys = defaults.map((d) => d.key);
    for (const k of ["search", "name", "importBatch", "assetType", "businessDomain", "assetClassification", "piiFlag", "cdeFlag"]) {
      expect(keys).toContain(k);
    }
  });

  it("keeps a real advanced set rather than hiding everything", () => {
    expect(ASSET_FILTERS.filter((d) => d.advanced).length).toBeGreaterThan(10);
  });

  it("drops the filters that cannot narrow anything", () => {
    const keys = ASSET_FILTERS.map((d) => d.key);
    for (const gone of ["storage", "backupFrequency", "classificationSource", "containsConflicts", "catalogId"]) {
      expect(keys).not.toContain(gone);
    }
  });

  it("keeps every remaining filter uniquely keyed", () => {
    const keys = ASSET_FILTERS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives both screens the same catalog switch", () => {
    const onAssets = ASSET_FILTERS.find((d) => d.key === "importBatch");
    const onAttributes = ATTRIBUTE_FILTERS.find((d) => d.key === "importBatch");
    expect(onAssets?.labelEn).toBe(onAttributes?.labelEn);
    expect(onAssets?.control).toBe("multiselect");
  });
});
