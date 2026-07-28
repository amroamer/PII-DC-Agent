import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret, hasEncryptionSecret } from "../../server/settings/secret";
import { resolveApiKey } from "../../server/ai-provider";
import { setSetting } from "../../server/reference-cache";

const ORIG = { ...process.env };
beforeEach(() => {
  process.env.SESSION_SECRET = "test-master-secret";
  delete process.env.SETTINGS_ENCRYPTION_KEY;
  delete process.env.OPENAI_API_KEY;
  setSetting("ai_api_key_enc", undefined);
});
afterEach(() => {
  process.env = { ...ORIG };
  setSetting("ai_api_key_enc", undefined);
});

describe("secret encryption", () => {
  it("round-trips a value: decrypt(encrypt(x)) === x", () => {
    const key = "sk-proj-abc123SECRETvalue";
    expect(decryptSecret(encryptSecret(key))).toBe(key);
  });

  it("produces a different ciphertext each time (random IV) but both decrypt", () => {
    const a = encryptSecret("same-key");
    const b = encryptSecret("same-key");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same-key");
    expect(decryptSecret(b)).toBe("same-key");
  });

  it("returns null on a tampered or malformed blob", () => {
    const blob = encryptSecret("secret");
    expect(decryptSecret(blob.slice(0, -4) + "AAAA")).toBeNull(); // corrupted ciphertext
    expect(decryptSecret("not-a-valid-blob")).toBeNull();
    expect(decryptSecret("gcm.v1:only:two")).toBeNull();
  });

  it("returns null when the master secret differs (rotation)", () => {
    const blob = encryptSecret("secret");
    process.env.SESSION_SECRET = "a-different-secret";
    expect(decryptSecret(blob)).toBeNull();
  });

  it("hasEncryptionSecret reflects whether a secret is configured", () => {
    expect(hasEncryptionSecret()).toBe(true);
    delete process.env.SESSION_SECRET;
    expect(hasEncryptionSecret()).toBe(false);
  });
});

describe("resolveApiKey precedence (stored > env > none)", () => {
  it("prefers the stored encrypted key over the env var", () => {
    process.env.OPENAI_API_KEY = "env-key";
    setSetting("ai_api_key_enc", encryptSecret("stored-key"));
    expect(resolveApiKey()).toBe("stored-key");
  });

  it("falls back to the env var when nothing is stored", () => {
    process.env.OPENAI_API_KEY = "env-key";
    expect(resolveApiKey()).toBe("env-key");
  });

  it("falls back to the env var when the stored blob can't be decrypted", () => {
    process.env.OPENAI_API_KEY = "env-key";
    setSetting("ai_api_key_enc", "gcm.v1:garbage:garbage:garbage");
    expect(resolveApiKey()).toBe("env-key");
  });

  it("returns empty string when neither is present (local unauthenticated endpoint)", () => {
    expect(resolveApiKey()).toBe("");
  });
});
