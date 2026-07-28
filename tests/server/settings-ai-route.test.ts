import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { registerSettingsRoutes } from "../../server/settings/routes";
import { encryptSecret } from "../../server/settings/secret";
import { setSetting } from "../../server/reference-cache";

/**
 * Exercises the real GET /api/settings/ai route (which reads only the in-memory cache +
 * env — no DB) to prove apiKeySource reflects what the engine will actually use. Auth is
 * stubbed so we hit the genuine handler, not a mock.
 */
const ORIG = { ...process.env };

describe("GET /api/settings/ai — apiKeySource", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => true;
      (req as unknown as { user: unknown }).user = { role: "admin" };
      next();
    });
    registerSettingsRoutes(app);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const a = server.address();
        baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
        resolve();
      });
    });
  });
  afterAll(() => server?.close());

  beforeEach(() => {
    process.env.SESSION_SECRET = "test-master-secret";
    delete process.env.OPENAI_API_KEY;
    setSetting("ai_api_key_enc", undefined);
    setSetting("ai_api_key_last4", undefined);
  });
  afterEach(() => {
    process.env = { ...ORIG };
    setSetting("ai_api_key_enc", undefined);
    setSetting("ai_api_key_last4", undefined);
  });

  async function get() {
    const res = await fetch(`${baseUrl}/api/settings/ai`);
    return res.json() as Promise<{ apiKeySource: string; apiKeyMasked: string }>;
  }

  it("reports 'none' when neither a stored nor env key exists", async () => {
    expect((await get()).apiKeySource).toBe("none");
  });

  it("reports 'env' when only OPENAI_API_KEY is set", async () => {
    process.env.OPENAI_API_KEY = "env-key-9999";
    const body = await get();
    expect(body.apiKeySource).toBe("env");
    expect(body.apiKeyMasked).toBe("••••9999");
  });

  it("reports 'stored' when a valid encrypted key is saved (and masks it)", async () => {
    setSetting("ai_api_key_enc", encryptSecret("sk-abcd-1234"));
    setSetting("ai_api_key_last4", "1234");
    process.env.OPENAI_API_KEY = "env-key"; // stored still wins
    const body = await get();
    expect(body.apiKeySource).toBe("stored");
    expect(body.apiKeyMasked).toBe("••••1234");
  });

  it("falls back to 'env' when the stored blob can't be decrypted", async () => {
    setSetting("ai_api_key_enc", "gcm.v1:bad:bad:bad");
    process.env.OPENAI_API_KEY = "env-key";
    expect((await get()).apiKeySource).toBe("env");
  });
});
