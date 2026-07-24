import { describe, expect, it } from "vitest";
import { resolveSelectionIds, type Selection } from "../../server/catalog/query";

describe("selection resolution (§13.6)", () => {
  const all = [1, 2, 3, 4, 5];

  it("all-matching with exclusions = filtered set minus exclusions", () => {
    const sel: Selection = { mode: "all-matching", filters: {}, excluded: [2, 4] };
    expect(resolveSelectionIds(all, sel)).toEqual([1, 3, 5]);
  });

  it("include returns the explicit ids", () => {
    expect(resolveSelectionIds(all, { mode: "include", ids: [7, 8] })).toEqual([7, 8]);
  });

  it("none resolves to empty", () => {
    expect(resolveSelectionIds(all, { mode: "none" })).toEqual([]);
  });

  it("all-matching with no exclusions equals the full filtered set", () => {
    expect(resolveSelectionIds(all, { mode: "all-matching", filters: {}, excluded: [] })).toEqual(all);
  });
});
