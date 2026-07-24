import type { Express } from "express";
import { asyncHandler, HttpError, requireAuth } from "../http";
import {
  bulkDecisionSchema,
  engineApproveSchema,
  engineRunCreateSchema,
  runItemDecisionSchema,
  type User,
} from "@shared/models/schema";
import {
  bulkDecision,
  cancelRun,
  compareRuns,
  getRun,
  getRunItems,
  patchRunItem,
  resolveRunItemIds,
  startEngineRun,
} from "./runs";
import { approveRun, discardRun } from "./approve";
import { getCommitPreview } from "./preview";

function actorId(req: { user?: unknown }): number | null {
  return (req.user as User | undefined)?.id ?? null;
}

export function registerEngineRoutes(app: Express): void {
  app.post(
    "/api/engine-runs",
    requireAuth,
    asyncHandler(async (req, res) => {
      const parsed = engineRunCreateSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid run request.");
      // Returns immediately with a 'running' row; processing streams in the background.
      const run = await startEngineRun(
        {
          engineType: parsed.data.engineType,
          screen: parsed.data.screen,
          selection: parsed.data.selection,
          params: parsed.data.params ?? {},
        },
        actorId(req),
      );
      res.json(run);
    }),
  );

  app.post(
    "/api/engine-runs/:id/cancel",
    requireAuth,
    asyncHandler(async (req, res) => {
      cancelRun(Number(String(req.params.id)));
      res.json({ ok: true });
    }),
  );

  app.get(
    "/api/engine-runs/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const run = await getRun(Number(String(req.params.id)));
      if (!run) throw new HttpError(404, "Engine run not found.");
      res.json(run);
    }),
  );

  app.get(
    "/api/engine-runs/:id/items",
    requireAuth,
    asyncHandler(async (req, res) => {
      const decision = typeof req.query.decision === "string" ? req.query.decision : undefined;
      res.json(await getRunItems(Number(String(req.params.id)), { decision }));
    }),
  );

  app.patch(
    "/api/engine-runs/:id/items/:itemId",
    requireAuth,
    asyncHandler(async (req, res) => {
      const parsed = runItemDecisionSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Invalid item decision.");
      res.json(await patchRunItem(Number(String(req.params.itemId)), parsed.data));
    }),
  );

  app.post(
    "/api/engine-runs/:id/bulk-decision",
    requireAuth,
    asyncHandler(async (req, res) => {
      const parsed = bulkDecisionSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Invalid bulk decision.");
      const runId = Number(String(req.params.id));
      const itemIds = await resolveRunItemIds(runId, parsed.data.selection);
      const updated = await bulkDecision(runId, itemIds, parsed.data.decision);
      res.json({ updated });
    }),
  );

  app.get(
    "/api/engine-runs/:id/compare/:otherId",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await compareRuns(Number(String(req.params.id)), Number(String(req.params.otherId))));
    }),
  );

  app.get(
    "/api/engine-runs/:id/preview",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await getCommitPreview(Number(String(req.params.id))));
    }),
  );

  app.post(
    "/api/engine-runs/:id/approve",
    requireAuth,
    asyncHandler(async (req, res) => {
      const parsed = engineApproveSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "A justification is required.");
      res.json(await approveRun(Number(String(req.params.id)), parsed.data.justification, actorId(req)));
    }),
  );

  app.post(
    "/api/engine-runs/:id/discard",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await discardRun(Number(String(req.params.id)), actorId(req)));
    }),
  );
}
