import type { Express } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { autoMapColumns, requiredFields, type IkcSheetType } from "@shared/lib/ikc-fields";
import { asyncHandler, HttpError, requireAuth } from "../http";
import { guessSheetType, parseWorkbook } from "./parse";
import { getIngestRun, getRunCounts, listIngestRuns, runImport } from "./import";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

interface CachedUpload {
  filename: string;
  sheetType: IkcSheetType;
  headers: string[];
  rows: Record<string, unknown>[];
}

// Parsed uploads live in memory until the steward confirms the mapping + import.
const uploadCache = new Map<string, CachedUpload>();

export function registerIngestRoutes(app: Express): void {
  app.post(
    "/api/ingest/upload",
    requireAuth,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      const file = req.file;
      if (!file) throw new HttpError(400, "No file uploaded (form field name: file).");

      const parsed = parseWorkbook(file.buffer);
      if (parsed.headers.length === 0) {
        throw new HttpError(400, "Could not read any columns from the workbook.");
      }

      const sheetType =
        typeof req.body?.sheetType === "string"
          ? (req.body.sheetType as IkcSheetType)
          : guessSheetType(parsed.headers);
      const mapping = autoMapColumns(parsed.headers, sheetType);
      const uploadId = randomUUID();

      uploadCache.set(uploadId, {
        filename: file.originalname,
        sheetType,
        headers: parsed.headers,
        rows: parsed.rows,
      });

      res.json({
        uploadId,
        filename: file.originalname,
        sheetType,
        headers: parsed.headers,
        mapping,
        rowCount: parsed.rows.length,
        preview: parsed.rows.slice(0, 5),
        requiredFields: requiredFields(sheetType).map((f) => f.key),
      });
    }),
  );

  app.post(
    "/api/ingest/import",
    requireAuth,
    asyncHandler(async (req, res) => {
      const uploadId = typeof req.body?.uploadId === "string" ? req.body.uploadId : "";
      if (!uploadId) throw new HttpError(400, "uploadId is required.");

      const cached = uploadCache.get(uploadId);
      if (!cached) throw new HttpError(404, "Upload not found or expired — please re-upload.");

      const sheetType = (req.body?.sheetType as IkcSheetType) ?? cached.sheetType;
      const mapping: Record<string, string | null> =
        req.body?.mapping ?? autoMapColumns(cached.headers, sheetType);

      const missing = requiredFields(sheetType).filter((f) => !mapping[f.key]);
      if (missing.length > 0) {
        throw new HttpError(
          400,
          `Unmapped required fields: ${missing.map((f) => f.header).join(", ")}`,
        );
      }

      const summary = await runImport({
        filename: cached.filename,
        sheetType,
        mapping,
        rows: cached.rows,
      });
      uploadCache.delete(uploadId);
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

  app.get(
    "/api/ingest/runs/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = Number(String(req.params.id));
      if (Number.isNaN(id)) throw new HttpError(400, "Invalid run id.");
      const run = await getIngestRun(id);
      if (!run) throw new HttpError(404, "Ingest run not found.");
      const counts = await getRunCounts(id);
      res.json({ ...run, counts });
    }),
  );
}
