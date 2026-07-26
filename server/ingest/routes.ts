import type { Express } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { asyncHandler, HttpError, requireAuth } from "../http";
import type { User } from "@shared/models/schema";
import { parseTwoSheetWorkbook } from "./parse";
import {
  applyIngestPlan,
  buildPreview,
  computeIngestPlan,
  listIngestRuns,
  type IngestPlan,
} from "./import";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

interface CachedPlan {
  plan: IngestPlan;
  createdAt: number;
}

// Computed plans live in memory between the review (upload) and the apply step.
const planCache = new Map<string, CachedPlan>();
const PLAN_TTL_MS = 60 * 60 * 1000; // 1 hour

function prunePlans(): void {
  const cutoff = Date.now() - PLAN_TTL_MS;
  for (const [id, entry] of planCache) {
    if (entry.createdAt < cutoff) planCache.delete(id);
  }
}

export function registerIngestRoutes(app: Express): void {
  // Step 1 — upload the two-sheet workbook, diff it, and return a review preview.
  // Nothing is written to the catalog here.
  app.post(
    "/api/ingest/upload",
    requireAuth,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      const file = req.file;
      if (!file) throw new HttpError(400, "No file uploaded (form field name: file).");

      const sheets = parseTwoSheetWorkbook(file.buffer);
      if (!sheets.assetSheet && !sheets.columnSheet) {
        throw new HttpError(400, "Could not read an Asset or Columns sheet from the workbook.");
      }

      const plan = await computeIngestPlan(sheets, file.originalname);
      prunePlans();
      const uploadId = randomUUID();
      planCache.set(uploadId, { plan, createdAt: Date.now() });

      res.json({ uploadId, ...buildPreview(plan) });
    }),
  );

  // Step 2 — apply the previously computed plan (only new rows + changed fields).
  app.post(
    "/api/ingest/apply",
    requireAuth,
    asyncHandler(async (req, res) => {
      const uploadId = typeof req.body?.uploadId === "string" ? req.body.uploadId : "";
      if (!uploadId) throw new HttpError(400, "uploadId is required.");

      const cached = planCache.get(uploadId);
      if (!cached) throw new HttpError(404, "Upload not found or expired — please re-upload.");

      const user = req.user as User | undefined;
      const summary = await applyIngestPlan(cached.plan, user?.id ?? null);
      planCache.delete(uploadId);
      res.json(summary);
    }),
  );

  app.get(
    "/api/ingest/runs",
    requireAuth,
    asyncHandler(async (_req, res) => {
      res.json(await listIngestRuns());
    }),
  );
}
