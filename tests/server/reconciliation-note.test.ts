import { describe, expect, it } from "vitest";
import { reconciliationNote } from "../../server/classification-engine/attribute-rules";
import type { ClassificationCode } from "@shared/lib/classification";

// A renamed level (e.g. SECRET → "Top Secret") flowing from the active framework into the
// stored rationale — the labelOf resolver the engine now passes.
const renamed = (code: ClassificationCode, lang: "en" | "ar" = "en"): string =>
  code === "SECRET" ? (lang === "ar" ? "سري جداً" : "Top Secret") : code;

describe("reconciliationNote uses the active level labels", () => {
  it("shows the built-in label by default", () => {
    const note = reconciliationNote("CONFIDENTIAL", "SECRET", null, true);
    expect(note.en).toContain("Secret");
    expect(note.en).not.toContain("Top Secret");
  });

  it("shows the steward's renamed label when a resolver is passed", () => {
    const note = reconciliationNote("CONFIDENTIAL", "SECRET", null, true, renamed);
    expect(note.en).toContain("Top Secret");
    // The renamed EN label must not leave the raw code or old label in the text.
    expect(note.en).toMatch(/Final level Top Secret/);
    expect(note.ar).toContain("سري جداً");
  });

  it("returns empty when the model and final levels agree (nothing to explain)", () => {
    expect(reconciliationNote("SECRET", "SECRET", null, true, renamed)).toEqual({ en: "", ar: "" });
  });

  it("suppresses Arabic when includeArabic is false", () => {
    const note = reconciliationNote("CONFIDENTIAL", "SECRET", null, false, renamed);
    expect(note.en).toContain("Top Secret");
    expect(note.ar).toBe("");
  });
});
