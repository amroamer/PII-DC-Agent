import { describe, expect, it } from "vitest";
import { sensitivityFloor } from "../../server/classification-engine/sensitivity";

/**
 * Coverage for the §8.2 deterministic sensitivity floor (new module shipping in this deploy).
 * It is a FLOOR keyed on the column name/description only — never the asset context — so
 * operational columns are not over-classified for merely sitting in a sensitive table.
 */
describe("sensitivityFloor (§8.2 deterministic floor)", () => {
  it("raises access credentials & classified markers to SECRET", () => {
    for (const name of ["password", "user_passwd", "password_hash", "password_salt", "api_key", "private_key", "refresh_token", "encryption_key", "classified_flag", "national_security_note"]) {
      expect(sensitivityFloor({ columnName: name })).toBe("SECRET");
    }
  });

  it("raises non-personal sensitive & special-category data to SENSITIVE", () => {
    for (const name of ["health_status", "biometric_template", "fingerprint_id", "religion", "ethnicity", "trade_secret", "source_code_ref", "proprietary_algorithm", "design_blueprint", "investment_strategy", "seizure_detail", "offender_name"]) {
      expect(sensitivityFloor({ columnName: name })).toBe("SENSITIVE");
    }
  });

  it("SECRET wins when both categories match", () => {
    // 'password' (SECRET) + 'health' (SENSITIVE) in the same haystack → SECRET.
    expect(sensitivityFloor({ columnName: "password", descriptionEn: "health record access" })).toBe("SECRET");
  });

  it("also reads the description, not just the column name", () => {
    expect(sensitivityFloor({ columnName: "col_a", descriptionEn: "stores the user's fingerprint scan" })).toBe("SENSITIVE");
    expect(sensitivityFloor({ columnName: "col_b", descriptionEn: "encrypted API key for the gateway" })).toBe("SECRET");
  });

  it("matches multi-word terms whether snake_cased (names) or space-separated (prose descriptions)", () => {
    // Column names are snake_case; descriptions are prose — both must trigger the floor.
    expect(sensitivityFloor({ columnName: "private_key" })).toBe("SECRET");
    expect(sensitivityFloor({ columnName: "c", descriptionEn: "the private key used for signing" })).toBe("SECRET");
    expect(sensitivityFloor({ columnName: "trade_secret_ref" })).toBe("SENSITIVE");
    expect(sensitivityFloor({ columnName: "d", descriptionEn: "documents a trade secret and source code" })).toBe("SENSITIVE");
  });

  it("does NOT over-classify ordinary/operational columns (returns null)", () => {
    for (const name of ["created_date", "is_disabled", "row_version", "record_id", "full_name", "email", "national_id", "phone_number", "amount"]) {
      expect(sensitivityFloor({ columnName: name })).toBeNull();
    }
  });

  it("handles empty / missing input safely", () => {
    expect(sensitivityFloor({ columnName: "" })).toBeNull();
    expect(sensitivityFloor({ columnName: "x", descriptionEn: null })).toBeNull();
  });
});
