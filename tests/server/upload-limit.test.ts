import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerIngestRoutes, UPLOAD_MAX_BYTES } from "../../server/ingest/routes";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("ingest upload size limit", () => {
  it("is 200 MB", () => {
    expect(UPLOAD_MAX_BYTES).toBe(200 * 1024 * 1024);
    expect(UPLOAD_MAX_BYTES).toBe(209715200);
  });

  it("does not exceed the nginx client_max_body_size that fronts it", () => {
    // A limit raised in the app but not at the proxy fails as an opaque 413
    // before the request ever reaches Express, so the two are pinned together.
    const conf = readFileSync(resolve(__dirname, "../../nginx/default.conf"), "utf8");
    const m = conf.match(/client_max_body_size\s+(\d+)m/i);
    expect(m, "client_max_body_size not found in nginx/default.conf").toBeTruthy();
    expect(Number(m![1]) * 1024 * 1024).toBeGreaterThanOrEqual(UPLOAD_MAX_BYTES);
  });
});

describe("Import Test file store", () => {
  it("shares the ingest ceiling rather than keeping its own", () => {
    // It had its own 50 MB cap, so the two upload paths drifted apart.
    const src = readFileSync(resolve(__dirname, "../../server/files/routes.ts"), "utf8");
    expect(src).toContain("UPLOAD_MAX_BYTES");
    expect(src).not.toMatch(/fileSize:\s*50\s*\*/);
  });
});

// End-to-end: a 60 MB upload (over the OLD 50 MB cap) must now pass multer and reach the
// handler — it fails there only because the dummy bytes aren't a real workbook, which proves
// the size gate accepted it (a size rejection would never reach the handler). Auth stubbed.
describe("ingest upload accepts files over the old 50 MB cap", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => true;
      (req as unknown as { user: unknown }).user = { id: 1, role: "admin" };
      next();
    });
    registerIngestRoutes(app);
    // Minimal error handler so a multer size-rejection would surface as JSON we can detect.
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const e = err as { code?: string; status?: number; message?: string };
      res.status(e.status ?? 500).json({ code: e.code, message: e.message });
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const a = server.address();
        baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
        resolve();
      });
    });
  });
  afterAll(() => server?.close());

  it("does not reject a 60 MB upload with a size error", async () => {
    const sixtyMB = new Uint8Array(60 * 1024 * 1024); // > old 50 MB limit, < new 200 MB limit
    const form = new FormData();
    form.append("file", new Blob([sixtyMB]), "big.xlsx");

    const res = await fetch(`${baseUrl}/api/ingest/upload`, { method: "POST", body: form });
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };

    // Multer would signal an oversize file with code LIMIT_FILE_SIZE / "File too large".
    expect(body.code).not.toBe("LIMIT_FILE_SIZE");
    expect(body.message ?? "").not.toMatch(/file too large/i);
    // It got PAST the size gate to the handler, which rejects the non-workbook bytes.
    expect(res.status).toBe(400);
    expect(body.message ?? "").toMatch(/Could not read|No file|Asset or Columns/i);
  });
});
