import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { asyncHandler, HttpError, requireAdmin, requireAuth } from "../http";
import {
  frameworkPutSchema,
  frameworks,
  frameworkVersions,
  type FrameworkType,
  type User,
} from "@shared/models/schema";
import {
  createVersion,
  getActiveFrameworkVersion,
  listVersions,
  restoreVersion,
} from "./store";
import { db } from "../db";

function frameworkType(raw: unknown): FrameworkType {
  if (raw === "pii" || raw === "classification") return raw;
  throw new HttpError(400, "Framework type must be 'pii' or 'classification'.");
}

/** Structural validation of an imported/edited framework definition (Prompt 2 §10). */
function validateDefinition(type: FrameworkType, definition: unknown): Record<string, unknown> {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new HttpError(400, "Framework definition must be an object.");
  }
  const def = definition as Record<string, unknown>;
  if (type === "pii") {
    if (!Array.isArray(def.criteria) || def.criteria.length === 0) {
      throw new HttpError(400, "PII framework must define a non-empty `criteria` array.");
    }
  } else {
    if (!Array.isArray(def.levels) || def.levels.length === 0) {
      throw new HttpError(400, "Classification framework must define a non-empty `levels` array.");
    }
    if (!Array.isArray(def.rules)) {
      throw new HttpError(400, "Classification framework must define a `rules` array.");
    }
  }
  return def;
}

export function registerFrameworkRoutes(app: Express): void {
  // Read is available to any authenticated user (the engine wizard needs it).
  app.get(
    "/api/frameworks/:type",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await getActiveFrameworkVersion(frameworkType(req.params.type)));
    }),
  );

  // A save creates a new immutable version. Admin only.
  app.put(
    "/api/frameworks/:type",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const type = frameworkType(req.params.type);
      const parsed = frameworkPutSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Invalid framework payload.");
      const definition = validateDefinition(type, parsed.data.definition);
      const actorId = (req.user as User | undefined)?.id ?? null;
      res.json(await createVersion(type, definition, parsed.data.changeNote, actorId));
    }),
  );

  app.get(
    "/api/frameworks/:type/versions",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await listVersions(frameworkType(req.params.type)));
    }),
  );

  // Version detail is scoped by :type so ids can't be read across frameworks.
  app.get(
    "/api/frameworks/:type/versions/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const type = frameworkType(req.params.type);
      const [framework] = await db.select().from(frameworks).where(eq(frameworks.type, type)).limit(1);
      if (!framework) throw new HttpError(404, "Framework not found.");
      const [row] = await db
        .select()
        .from(frameworkVersions)
        .where(and(eq(frameworkVersions.id, Number(String(req.params.id))), eq(frameworkVersions.frameworkId, framework.id)))
        .limit(1);
      if (!row) throw new HttpError(404, "Version not found for this framework.");
      res.json(row);
    }),
  );

  app.post(
    "/api/frameworks/:type/restore/:versionId",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const restored = await restoreVersion(frameworkType(req.params.type), Number(String(req.params.versionId)));
      if (!restored) throw new HttpError(404, "Version not found.");
      res.json(restored);
    }),
  );

  app.get(
    "/api/frameworks/:type/export",
    requireAuth,
    asyncHandler(async (req, res) => {
      const type = frameworkType(req.params.type);
      const active = await getActiveFrameworkVersion(type);
      res.setHeader("Content-Disposition", `attachment; filename="pdtc-framework-${type}.json"`);
      res.json({ type, version: active.version, definition: active.definition });
    }),
  );

  app.post(
    "/api/frameworks/:type/import",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const type = frameworkType(req.params.type);
      const definition = validateDefinition(type, req.body?.definition);
      const actorId = (req.user as User | undefined)?.id ?? null;
      res.json(await createVersion(type, definition, "Imported framework.", actorId));
    }),
  );
}
