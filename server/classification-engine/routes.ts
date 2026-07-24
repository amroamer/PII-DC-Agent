import type { Express } from "express";
import { asyncHandler, HttpError, requireAuth } from "../http";
import { classificationOverrideSchema, type User } from "@shared/models/schema";
import { runClassification } from "./index";
import { applyClassificationOverride } from "./override";
import { getAssetClassifications, getAttributeClassifications } from "./read";
import { getCompletionReport } from "./completion";

export function registerClassificationRoutes(app: Express): void {
  app.post(
    "/api/classification/runs",
    requireAuth,
    asyncHandler(async (req, res) => {
      const runId = typeof req.body?.runId === "string" ? req.body.runId : undefined;
      res.json(await runClassification(runId));
    }),
  );

  app.get(
    "/api/classification/attributes",
    requireAuth,
    asyncHandler(async (_req, res) => {
      res.json(await getAttributeClassifications());
    }),
  );

  app.get(
    "/api/classification/assets",
    requireAuth,
    asyncHandler(async (_req, res) => {
      res.json(await getAssetClassifications());
    }),
  );

  // Override REQUIRES a non-empty rationale (enforced by the zod schema).
  app.post(
    "/api/classification/override",
    requireAuth,
    asyncHandler(async (req, res) => {
      const parsed = classificationOverrideSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid override payload.");
      }
      const actorId = (req.user as User | undefined)?.id ?? null;
      const row = await applyClassificationOverride(parsed.data, actorId);
      res.json(row);
    }),
  );

  app.get(
    "/api/classification/completion",
    requireAuth,
    asyncHandler(async (_req, res) => {
      res.json(await getCompletionReport());
    }),
  );
}
