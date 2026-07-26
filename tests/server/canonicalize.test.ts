import { describe, expect, it } from "vitest";
import {
  canonicalizeAttribute,
  computeInputHash,
  normStr,
  type CanonicalAttribute,
} from "../../server/pii-engine/canonicalize";

const asset = { name: "Travellers", businessDomain: "Border", subjectArea: "Traveller" };
const versions = {
  promptVersion: "p@1",
  frameworkVersion: "pii-1.0",
  modelId: "test-model",
  engineVersion: "0.1.0",
  schemaVersion: "pii-assess-v1",
  systemPrompt: "base system prompt",
};

describe("canonicalisation + hashing (determinism §7.2/§7.3)", () => {
  it("NFC-normalises and collapses whitespace", () => {
    // "café" as NFC vs NFD (e + combining acute), plus doubled spaces.
    const nfc = normStr("café  value");
    const nfd = normStr("café value");
    expect(nfc).toBe(nfd);
    expect(nfc).toBe("café value");
  });

  it("produces the same hash for inputs differing only in Unicode form / whitespace", () => {
    const a = canonicalizeAttribute(
      { assetId: 1, columnName: "email  address", descriptionEn: "café", descriptionAr: "  ", dataType: "VARCHAR", nativeType: null },
      asset,
      ["b", "a"],
    );
    const b = canonicalizeAttribute(
      { assetId: 1, columnName: "email address", descriptionEn: "café", descriptionAr: null, dataType: "VARCHAR", nativeType: null },
      asset,
      ["a", "b"],
    );
    expect(a).toEqual(b);
    expect(computeInputHash({ payload: a, ...versions })).toBe(computeInputHash({ payload: b, ...versions }));
  });

  it("hash is independent of object key insertion order", () => {
    const base: CanonicalAttribute = {
      assetId: 1, columnName: "x", descriptionEn: "y", descriptionAr: "z", dataType: "d",
      nativeType: "n", assetName: "a", businessDomain: "b", subjectArea: "s", siblingColumns: "c",
    };
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as unknown as CanonicalAttribute;
    expect(computeInputHash({ payload: reordered, ...versions })).toBe(computeInputHash({ payload: base, ...versions }));
  });

  it("hash changes when a version identifier changes (natural cache invalidation)", () => {
    const payload = canonicalizeAttribute({ assetId: 1, columnName: "x", descriptionEn: "", descriptionAr: "", dataType: "", nativeType: "" }, asset, []);
    const h1 = computeInputHash({ payload, ...versions });
    const h2 = computeInputHash({ payload, ...versions, frameworkVersion: "pii-2.0" });
    expect(h1).not.toBe(h2);
  });

  it("hash changes when the composed system prompt (injected criteria) changes", () => {
    const payload = canonicalizeAttribute({ assetId: 1, columnName: "x", descriptionEn: "", descriptionAr: "", dataType: "", nativeType: "" }, asset, []);
    const h1 = computeInputHash({ payload, ...versions });
    const h2 = computeInputHash({ payload, ...versions, systemPrompt: "base + edited criteria block" });
    expect(h1).not.toBe(h2);
  });
});
