import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { registerSettingsRoutes } from "../../server/settings/routes";
import { setPrompt } from "../../server/reference-cache";

/**
 * GET /api/settings/prompts must expose ONLY prompts the engine actually loads, so a
 * steward never edits a dead prompt. Reads the in-memory cache (no DB); auth is stubbed.
 */
describe("GET /api/settings/prompts hides dead prompts", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    for (const key of ["pii_detection_classify", "classification_classify", "cooccurrence_assess", "classification_rationale"]) {
      setPrompt({ key, label: key, content: "x" });
    }
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => true;
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

  it("returns only the two live prompts, not the co-occurrence / rationale ones", async () => {
    const res = await fetch(`${baseUrl}/api/settings/prompts`);
    const prompts = (await res.json()) as { key: string }[];
    const keys = prompts.map((p) => p.key).sort();
    expect(keys).toEqual(["classification_classify", "pii_detection_classify"]);
    expect(keys).not.toContain("cooccurrence_assess");
    expect(keys).not.toContain("classification_rationale");
  });
});
