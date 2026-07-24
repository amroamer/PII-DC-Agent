import type { Express } from "express";
import { asyncHandler, HttpError, requireAuth } from "../http";
import { reviewDecisionSchema, type ReviewStatus, type User } from "@shared/models/schema";
import { listReviewItems, resolveReview } from "./service";
import { listAudit } from "../audit";

const STATUSES: ReviewStatus[] = ["pending", "accepted", "rejected", "overridden"];

export function registerReviewRoutes(app: Express): void {
  app.get(
    "/api/review/items",
    requireAuth,
    asyncHandler(async (req, res) => {
      const status =
        typeof req.query.status === "string" && STATUSES.includes(req.query.status as ReviewStatus)
          ? (req.query.status as ReviewStatus)
          : undefined;
      res.json(await listReviewItems(status));
    }),
  );

  // Resolve a review item. Rationale is REQUIRED (enforced by the zod schema).
  app.post(
    "/api/review/decision",
    requireAuth,
    asyncHandler(async (req, res) => {
      const parsed = reviewDecisionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid review decision.");
      }
      const actorId = (req.user as User | undefined)?.id ?? null;
      res.json(await resolveReview(parsed.data, actorId));
    }),
  );

  app.get(
    "/api/review/audit",
    requireAuth,
    asyncHandler(async (req, res) => {
      const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
      const entityId = typeof req.query.entityId === "string" ? req.query.entityId : undefined;
      res.json(await listAudit(entityType, entityId));
    }),
  );
}
