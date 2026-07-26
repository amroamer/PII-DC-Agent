import type { Express } from "express";
import { asyncHandler, HttpError, requireAuth } from "../http";
import { exportRequestSchema, type User } from "@shared/models/schema";
import { resolveSelection } from "../catalog/query";
import { createExport, downloadExport } from "./export";

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
}
