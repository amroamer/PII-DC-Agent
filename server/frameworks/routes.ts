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
import { CRITERION_CODES, isCriterionCode } from "@shared/lib/criteria";
import { CLASSIFICATION_CODES, isClassificationCode } from "@shared/lib/classification";
import { db } from "../db";

const RULE_VERDICTS = ["pii", "not_pii", "uncertain"];

function frameworkType(raw: unknown): FrameworkType {
  if (raw === "pii" || raw === "classification") return raw;
  throw new HttpError(400, "Framework type must be 'pii' or 'classification'.");
}

/** Structural validation of an imported/edited framework definition (Prompt 2 §10). */
export function validateDefinition(type: FrameworkType, definition: unknown): Record<string, unknown> {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new HttpError(400, "Framework definition must be an object.");
  }
  const def = definition as Record<string, unknown>;
  if (type === "pii") {
    if (!Array.isArray(def.criteria) || def.criteria.length === 0) {
      throw new HttpError(400, "PII framework must define a non-empty `criteria` array.");
    }
    const seen = new Set<string>();
    for (const raw of def.criteria) {
      const c = (raw ?? {}) as Record<string, unknown>;
      if (!isCriterionCode(c.code)) {
        throw new HttpError(400, `Unknown or missing criterion code: ${JSON.stringify(c.code)}.`);
      }
      if (typeof c.nameEn !== "string" || typeof c.nameAr !== "string" || typeof c.description !== "string") {
        throw new HttpError(400, `Criterion ${c.code} needs string nameEn, nameAr and description.`);
      }
      if (c.evaluationMode !== "intrinsic" && c.evaluationMode !== "contextual") {
        throw new HttpError(400, `Criterion ${c.code} evaluationMode must be "intrinsic" or "contextual".`);
      }
      seen.add(c.code);
    }
    // The strict LLM schema + merge logic key off the canonical code set — codes are fixed.
    const missing = CRITERION_CODES.filter((code) => !seen.has(code));
    if (missing.length || seen.size !== def.criteria.length) {
      throw new HttpError(
        400,
        `PII criteria must be exactly the ${CRITERION_CODES.length} policy codes with no duplicates (${missing.length ? `missing ${missing.join(", ")}` : "duplicate code"}).`,
      );
    }
  } else {
    if (!Array.isArray(def.levels) || def.levels.length === 0) {
      throw new HttpError(400, "Classification framework must define a non-empty `levels` array.");
    }
    // Labels/colors/rank are editable, but the CODE set is a fixed enum (used as a DB + LLM
    // enum in many places), so lock it to exactly the canonical four with no dupes.
    const levelCodes = new Set<string>();
    for (const raw of def.levels) {
      const l = (raw ?? {}) as Record<string, unknown>;
      if (!isClassificationCode(l.code)) {
        throw new HttpError(400, `Unknown or missing level code: ${JSON.stringify(l.code)}.`);
      }
      if (typeof l.labelEn !== "string" || typeof l.labelAr !== "string") {
        throw new HttpError(400, `Level ${l.code} needs string labelEn and labelAr.`);
      }
      if (l.rank !== undefined && typeof l.rank !== "number") {
        throw new HttpError(400, `Level ${l.code} rank must be a number.`);
      }
      levelCodes.add(l.code);
    }
    const missingLevels = CLASSIFICATION_CODES.filter((code) => !levelCodes.has(code));
    if (missingLevels.length || levelCodes.size !== def.levels.length) {
      throw new HttpError(
        400,
        `Classification levels must be exactly the ${CLASSIFICATION_CODES.length} codes with no duplicates (${missingLevels.length ? `missing ${missingLevels.join(", ")}` : "duplicate code"}).`,
      );
    }
    if (!Array.isArray(def.rules)) {
      throw new HttpError(400, "Classification framework must define a `rules` array.");
    }
    for (const raw of def.rules) {
      const r = (raw ?? {}) as Record<string, unknown>;
      if (typeof r.id !== "string") throw new HttpError(400, "Each classification rule needs a string `id`.");
      if (!isClassificationCode(r.level)) throw new HttpError(400, `Rule ${r.id} has an unknown level: ${JSON.stringify(r.level)}.`);
      if (r.criterion !== undefined && !isCriterionCode(r.criterion)) throw new HttpError(400, `Rule ${r.id} has an unknown criterion: ${JSON.stringify(r.criterion)}.`);
      if (r.verdict !== undefined && !RULE_VERDICTS.includes(r.verdict as string)) throw new HttpError(400, `Rule ${r.id} has an unknown verdict: ${JSON.stringify(r.verdict)}.`);
      if (r.isSpecialCategory !== undefined && typeof r.isSpecialCategory !== "boolean") throw new HttpError(400, `Rule ${r.id} isSpecialCategory must be a boolean.`);
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
