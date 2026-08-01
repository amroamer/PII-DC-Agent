import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiComplete, AiUnavailableError } from "../../server/ai-provider";
import { setSetting } from "../../server/reference-cache";

/** Verifies the Settings → AI "Max retries" and "Timeout" values actually drive aiComplete. */
const ORIG = { ...process.env };

beforeEach(() => {
  process.env.OPENAI_BASE_URL = "http://ai.local/v1";
  process.env.OPENAI_MODEL = "test-model";
  delete process.env.OPENAI_API_KEY;
  process.env.SESSION_SECRET = "s";
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIG };
  setSetting("ai_max_retries", undefined);
  setSetting("ai_timeout", undefined);
  setSetting("ai_api_key_enc", undefined);
});

const resp503 = () => ({ ok: false, status: 503, headers: { get: () => null }, text: async () => "", json: async () => ({}) }) as unknown as Response;

describe("ai_max_retries drives the number of attempts", () => {
  it("maxRetries = 0 → exactly one attempt", async () => {
    setSetting("ai_max_retries", 0);
    setSetting("ai_timeout", 30000);
    const fetchMock = vi.fn(async () => resp503());
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiComplete({ prompt: "x" })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maxRetries = 2 → three attempts (1 + 2 retries)", async () => {
    setSetting("ai_max_retries", 2);
    setSetting("ai_timeout", 30000);
    const fetchMock = vi.fn(async () => resp503());
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiComplete({ prompt: "x" })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("ai_timeout aborts a hung request so it can be retried", () => {
  it("aborts on timeout and retries, then fails with a timeout message", async () => {
    setSetting("ai_timeout", 40); // 40 ms — fires before any (never-resolving) response
    setSetting("ai_max_retries", 1); // 2 attempts total
    // A fetch that never resolves but rejects when its abort signal fires.
    const fetchMock = vi.fn(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise<Response>((_res, rej) => {
          opts.signal.addEventListener("abort", () =>
            rej(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiComplete({ prompt: "x" })).rejects.toThrow(/timed out/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
