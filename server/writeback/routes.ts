import type { Express } from "express";
import { asyncHandler, requireAuth } from "../http";
import { previewWriteback } from "./index";

export function registerWritebackRoutes(app: Express): void {
  // Preview the IKC custom-attribute payload. Stub — no live IKC dispatch.
  app.get(
    "/api/writeback/preview",
    requireAuth,
    asyncHandler(async (_req, res) => {
      res.json(await previewWriteback());
    }),
  );
}
