import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiComplete, testConnection } from "../../server/ai-provider";
import { encryptSecret } from "../../server/settings/secret";
import { setSetting } from "../../server/reference-cache";

/**
 * End-to-end proof that the resolved API key actually reaches the wire: we mock
 * fetch and inspect the outgoing Authorization header for both the real request
 * path (aiComplete) and the connection test (testConnection).
 */
const ORIG = { ...process.env };

function stubFetch() {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (url: unknown, init: unknown) => {
    const i = (init ?? {}) as { headers?: Record<string, string> };
    calls.push({ url: String(url), headers: i.headers ?? {} });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ model: "test-model", choices: [{ message: { content: "{}" } }] }),
      text: async () => "",
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

beforeEach(() => {
  process.env.SESSION_SECRET = "test-master-secret";
  process.env.OPENAI_BASE_URL = "http://ai.local/v1";
  process.env.OPENAI_MODEL = "test-model";
  delete process.env.OPENAI_API_KEY;
  delete process.env.SETTINGS_ENCRYPTION_KEY;
  setSetting("ai_api_key_enc", undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIG };
  setSetting("ai_api_key_enc", undefined);
});

describe("the resolved key reaches the AI request's Authorization header", () => {
  it("aiComplete sends the STORED (encrypted) key", async () => {
    process.env.OPENAI_API_KEY = "env-key"; // present, but stored must win
    setSetting("ai_api_key_enc", encryptSecret("stored-key-123"));
    const calls = stubFetch();

    await aiComplete({ prompt: "hi" });

    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Authorization).toBe("Bearer stored-key-123");
  });

  it("aiComplete falls back to the env key when nothing is stored", async () => {
    process.env.OPENAI_API_KEY = "env-key";
    const calls = stubFetch();

    await aiComplete({ prompt: "hi" });

    expect(calls[0].headers.Authorization).toBe("Bearer env-key");
  });

  it("aiComplete sends NO Authorization header when there is no key (local endpoint)", async () => {
    const calls = stubFetch();

    await aiComplete({ prompt: "hi" });

    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("testConnection also authenticates with the stored key", async () => {
    setSetting("ai_api_key_enc", encryptSecret("stored-key-xyz"));
    const calls = stubFetch();

    const result = await testConnection();

    expect(result.ok).toBe(true);
    expect(calls[0].headers.Authorization).toBe("Bearer stored-key-xyz");
  });

  it("the value stored at rest is ciphertext, not the plaintext key", () => {
    const blob = encryptSecret("sk-super-secret-value");
    expect(blob).not.toContain("sk-super-secret-value");
    expect(blob.startsWith("gcm.v1:")).toBe(true);
  });
});
