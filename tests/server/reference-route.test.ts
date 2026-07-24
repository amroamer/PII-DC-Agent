import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { registerSettingsRoutes } from "../../server/settings/routes";

// The /api/reference route reads only the in-memory reference cache (no DB), so it
// exercises the real Express route surface without needing Postgres.
describe("GET /api/reference", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    registerSettingsRoutes(app);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server?.close();
  });

  it("returns the five policy criteria and the four ISMS levels", async () => {
    const res = await fetch(`${baseUrl}/api/reference`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { criteria: unknown[]; levels: unknown[] };
    expect(body.criteria).toHaveLength(5);
    expect(body.levels).toHaveLength(4);
  });
});
