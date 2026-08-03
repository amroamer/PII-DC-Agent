import type { Express } from "express";
import { asyncHandler, HttpError, requireAuth } from "../http";
import { runDetectionSchema, type DetectionVerdict } from "@shared/models/schema";
import { isCriterionCode } from "@shared/lib/criteria";
import { runDetection } from "./index";
import { getEvidence, getLatestRunId, getResults, getRunStatus } from "./results";
import { buildReviewQueue } from "../review/service";

const VERDICTS: DetectionVerdict[] = ["pii", "not_pii", "uncertain"];

export function registerPiiRoutes(app: Express): void {
  // Start a detection run, then (re)build the steward review queue from it.
  app.post(
    "/api/pii-detection/runs",
    requireAuth,
    asyncHandler(async (req, res) => {
      const parsed = runDetectionSchema.safeParse(req.body ?? {});
      const opts = parsed.success ? parsed.data : { useLlmLayer: true };
      const result = await runDetection({
        runId: opts.runId,
        useLlmLayer: opts.useLlmLayer ?? true,
      });
      const reviewItemsCreated = await buildReviewQueue(result.runId);
      res.json({ ...result, reviewItemsCreated });
    }),
  );

  app.get(
    "/api/pii-detection/runs/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await getRunStatus(String(req.params.id)));
    }),
  );

  app.get(
    "/api/pii-detection/results",
    requireAuth,
    asyncHandler(async (req, res) => {
      const q = req.query;
      const criterion =
        typeof q.criterion === "string" && isCriterionCode(q.criterion) ? q.criterion : undefined;
      const verdict =
        typeof q.verdict === "string" && VERDICTS.includes(q.verdict as DetectionVerdict)
          ? (q.verdict as DetectionVerdict)
          : undefined;
      const minConfidence = q.minConfidence ? Number(q.minConfidence) : undefined;
      const assetId = q.assetId ? Number(q.assetId) : undefined;
      const runId = typeof q.runId === "string" ? q.runId : undefined;
      const search = typeof q.search === "string" ? q.search : undefined;
      // Paginated: a full run is thousands of rows and the table used to render
      // every one of them into the DOM at once.
      const page = Math.max(1, Number(q.page) || 1);
      const pageSize = Math.min(Math.max(1, Number(q.pageSize) || 50), 200);

      const results = await getResults({ runId, criterion, verdict, minConfidence, assetId, search });
      res.json({
        runId: runId ?? (await getLatestRunId()),
        count: results.length,
        page,
        pageSize,
        results: results.slice((page - 1) * pageSize, page * pageSize),
      });
    }),
  );

  app.get(
    "/api/pii-detection/evidence/:detectionId",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = Number(String(req.params.detectionId));
      if (Number.isNaN(id)) throw new HttpError(400, "Invalid detection id.");
      const evidence = await getEvidence(id);
      if (!evidence) throw new HttpError(404, "Detection not found.");
      res.json(evidence);
    }),
  );
}
