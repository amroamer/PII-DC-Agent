import type { Express } from "express";
import { createServer, type Server } from "node:http";
import { seedReferenceData } from "./seed";
import { setupAuth } from "./auth";
import { setupVite, serveStatic } from "./vite";
import { registerSettingsRoutes } from "./settings/routes";
import { registerIngestRoutes } from "./ingest/routes";
import { registerPiiRoutes } from "./pii-engine/routes";
import { registerClassificationRoutes } from "./classification-engine/routes";
import { registerReviewRoutes } from "./review/routes";
import { registerWritebackRoutes } from "./writeback/routes";
import { registerCatalogRoutes } from "./catalog/routes";
import { registerEngineRoutes } from "./engine/routes";
import { pruneOldRuns, recoverStaleRuns } from "./engine/runs";
import { registerFrameworkRoutes } from "./frameworks/routes";
import { registerExportImportRoutes } from "./exchange/routes";
import { registerFileRoutes } from "./files/routes";

export async function registerRoutes(app: Express): Promise<Server> {
  // Idempotent seeds fill the DB + the in-memory reference cache. Must complete
  // BEFORE any route that depends on seeded criteria / levels / prompts / rules.
  await seedReferenceData();

  // Any run left 'running' by a prior process can never resume — mark it failed.
  // Then enforce the run-retention policy (delete terminal runs past the cutoff).
  try {
    await recoverStaleRuns();
    await pruneOldRuns();
  } catch {
    /* DB unavailable — handled the same way as seeding */
  }

  // Daily retention sweep for long-lived processes (boot-time prune covers restarts).
  // Unref'd so this timer never keeps the process alive on its own.
  const DAY_MS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    pruneOldRuns().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Scheduled run-retention prune failed:", err);
    });
  }, DAY_MS).unref();

  setupAuth(app);

  registerSettingsRoutes(app);
  registerIngestRoutes(app);
  registerPiiRoutes(app);
  registerClassificationRoutes(app);
  registerReviewRoutes(app);
  registerWritebackRoutes(app);
  registerCatalogRoutes(app);
  registerEngineRoutes(app);
  registerFrameworkRoutes(app);
  registerExportImportRoutes(app);
  registerFileRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", app: "pdtc" });
  });

  const server = createServer(app);

  // SPA last: API routes above take precedence, everything else -> the client.
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    await setupVite(app, server);
  }

  return server;
}
