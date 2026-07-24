import { describe, expect, it } from "vitest";
import { moreRestrictive, rollupLevel } from "@shared/lib/classification";
import { rollupAssetLevel } from "../../server/classification-engine/rollup";

describe("classification rollup precedence", () => {
  it("takes the high-water-mark (highest rank) across attribute levels", () => {
    expect(rollupLevel(["PUBLIC", "INTERNAL", "CONFIDENTIAL"])).toBe("CONFIDENTIAL");
    expect(rollupLevel(["PUBLIC", "SECRET", "INTERNAL"])).toBe("SECRET");
    expect(rollupLevel(["PUBLIC", "PUBLIC"])).toBe("PUBLIC");
  });

  it("returns null for an empty set", () => {
    expect(rollupLevel([])).toBeNull();
  });

  it("resolves ties to the more restrictive level", () => {
    expect(moreRestrictive("CONFIDENTIAL", "INTERNAL")).toBe("CONFIDENTIAL");
    expect(moreRestrictive("PUBLIC", "SECRET")).toBe("SECRET");
    expect(moreRestrictive("CONFIDENTIAL", "CONFIDENTIAL")).toBe("CONFIDENTIAL");
  });

  it("names the driving attribute(s) in the asset rollup", () => {
    const result = rollupAssetLevel([
      { attributeId: 1, columnName: "email", level: "CONFIDENTIAL" },
      { attributeId: 2, columnName: "created_at", level: "PUBLIC" },
      { attributeId: 3, columnName: "national_id", level: "CONFIDENTIAL" },
    ]);
    expect(result.level).toBe("CONFIDENTIAL");
    expect(result.drivers).toEqual(["email", "national_id"]);
  });
});
