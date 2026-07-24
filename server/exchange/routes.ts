import type { Express } from "express";
import multer from "multer";
import { asyncHandler, HttpError, requireAuth } from "../http";
import {
  exportRequestSchema,
  importApproveSchema,
  importDecisionsSchema,
  selectionSchema,
  type User,
} from "@shared/models/schema";
import { resolveSelection } from "../catalog/query";
import { createExport, downloadExport } from "./export";
import { approveImport, createImport, listDiffs, resolveDiffIds, setDiffDecisions } from "./import";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

export function registerExportImportRoutes(app: Express): void {
  app.post(
    "/api/exports",
    requireAuth,
    asyncHandler(async (req, res) => {
      const parsed = exportRequestSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid export request.");
      const user = req.user as User | undefined;

      // Resolve a selection scope to concrete ids before generating.
      let scope = { kind: parsed.data.scope.kind, filters: parsed.data.scope.filters } as {
        kind: "selection" | "filter" | "all";
        ids?: number[];
        filters?: Record<string, unknown>;
      };
      if (parsed.data.scope.kind === "selection" && parsed.data.scope.selection) {
        const ids = await resolveSelection(parsed.data.screen, parsed.data.scope.selection);
        scope = { kind: "selection", ids };
      }

      const result = await createExport(
        { screen: parsed.data.screen, scope, columns: parsed.data.columns },
        user?.id ?? null,
        user?.username ?? "steward",
      );
      res.json(result);
    }),
  );

  app.get(
    "/api/exports/:id/download",
    requireAuth,
    asyncHandler(async (req, res) => {
      const result = await downloadExport(Number(String(req.params.id)));
      if (!result) throw new HttpError(404, "Export not found.");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.send(result.buffer);
    }),
  );

  app.post(
    "/api/imports",
    requireAuth,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new HttpError(400, "No file uploaded (field name: file).");
      const user = req.user as User | undefined;
      const result = await createImport(req.file.buffer, req.file.originalname, user?.id ?? null);
      res.json(result);
    }),
  );

  app.get(
    "/api/imports/:id/diffs",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(
        await listDiffs(Number(String(req.params.id)), {
          changeType: typeof req.query.changeType === "string" ? req.query.changeType : undefined,
          page: req.query.page ? Number(req.query.page) : undefined,
          pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
        }),
      );
    }),
  );

  app.post(
    "/api/imports/:id/decisions",
    requireAuth,
    asyncHandler(async (req, res) => {
      const parsed = importDecisionsSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Invalid decisions payload.");
      const batchId = Number(String(req.params.id));
      const sel = selectionSchema.parse(parsed.data.selection);
      const ids = await resolveDiffIds(batchId, sel as { mode: string; ids?: number[]; excluded?: number[] });
      const updated = await setDiffDecisions(ids, parsed.data.status);
      res.json({ updated });
    }),
  );

  app.post(
    "/api/imports/:id/approve",
    requireAuth,
    asyncHandler(async (req, res) => {
      const parsed = importApproveSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "A justification is required.");
      const user = req.user as User | undefined;
      res.json(await approveImport(Number(String(req.params.id)), parsed.data.justification, user?.id ?? null));
    }),
  );
}
