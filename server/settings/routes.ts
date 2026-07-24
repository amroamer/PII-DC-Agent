import type { Express } from "express";
import { eq } from "drizzle-orm";
import { asyncHandler, HttpError, requireAdmin, requireAuth } from "../http";
import { db } from "../db";
import { appSettings, systemPrompts, type User } from "@shared/models/schema";
import { testConnection } from "../ai-provider";
import { cacheStats, clearCache } from "../engine/cache";
import { appendAudit } from "../audit";
import {
  getClassificationRules,
  getCriteria,
  getDataClasses,
  getLevels,
  getSetting,
  listPrompts,
  setPrompt,
  setSetting,
} from "../reference-cache";

export function registerSettingsRoutes(app: Express): void {
  // Reference data for the client (criteria, ISMS levels, data-class library).
  app.get("/api/reference", (_req, res) => {
    res.json({
      criteria: getCriteria(),
      levels: getLevels(),
      dataClasses: getDataClasses(),
    });
  });

  app.get("/api/settings/prompts", requireAuth, (_req, res) => {
    res.json(listPrompts());
  });

  // Edit an LLM system prompt (persist + refresh cache).
  app.put(
    "/api/settings/prompts/:key",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const key = String(req.params.key);
      const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
      if (!content) throw new HttpError(400, "Prompt content cannot be empty.");

      const [existing] = await db
        .select()
        .from(systemPrompts)
        .where(eq(systemPrompts.key, key))
        .limit(1);
      const label = typeof req.body?.label === "string" ? req.body.label : existing?.label ?? key;

      await db
        .insert(systemPrompts)
        .values({ key, label, content, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: systemPrompts.key,
          set: { content, label, updatedAt: new Date() },
        });

      setPrompt({ key, label, content });
      res.json({ key, label, content });
    }),
  );

  app.get("/api/settings/data-classes", requireAuth, (_req, res) => {
    res.json(getDataClasses());
  });

  app.get("/api/settings/rules", requireAuth, (_req, res) => {
    res.json(getClassificationRules());
  });

  app.get("/api/settings/thresholds", requireAuth, (_req, res) => {
    res.json({
      confidenceReviewThreshold: getSetting<number>("confidence_review_threshold") ?? 0.6,
      cooccurrenceMinQuasiIdentifiers:
        getSetting<number>("cooccurrence_min_quasi_identifiers") ?? 2,
      engineVersion: getSetting<string>("engine_version") ?? "0.1.0",
    });
  });

  // --- AI provider settings (Prompt 2 §10.1) -------------------------------
  app.get("/api/settings/ai", requireAuth, (_req, res) => {
    const last4 = getSetting<string>("ai_api_key_last4") ?? (process.env.OPENAI_API_KEY ?? "").slice(-4);
    res.json({
      baseUrl: process.env.OPENAI_BASE_URL ?? "",
      model: process.env.OPENAI_MODEL ?? "",
      apiKeyMasked: last4 ? `••••${last4}` : "(not set)",
      timeout: getSetting<number>("ai_timeout") ?? 30000,
      maxRetries: getSetting<number>("ai_max_retries") ?? 2,
      seed: getSetting<number>("inference_seed") ?? 42,
      temperature: 0,
      batchSize: getSetting<number>("default_batch_size") ?? 25,
      confidenceThreshold: getSetting<number>("confidence_review_threshold") ?? 0.6,
      confidenceFloor: getSetting<number>("confidence_floor") ?? 0.3,
      selfConsistencySamples: getSetting<number>("ai_self_consistency") ?? 1,
      maxBatchSize: getSetting<number>("max_batch_size") ?? 5000,
    });
  });

  app.put(
    "/api/settings/ai",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      // API key is write-only: persist only the last 4 chars, never the full value.
      if (typeof body.apiKey === "string" && body.apiKey.length >= 4) {
        const last4 = body.apiKey.slice(-4);
        await db.insert(appSettings).values({ key: "ai_api_key_last4", value: last4 }).onConflictDoUpdate({ target: appSettings.key, set: { value: last4 } });
        setSetting("ai_api_key_last4", last4);
      }
      const numericKeys: Record<string, string> = {
        timeout: "ai_timeout",
        maxRetries: "ai_max_retries",
        seed: "inference_seed",
        batchSize: "default_batch_size",
        confidenceThreshold: "confidence_review_threshold",
        confidenceFloor: "confidence_floor",
        selfConsistencySamples: "ai_self_consistency",
        maxBatchSize: "max_batch_size",
      };
      for (const [field, settingKey] of Object.entries(numericKeys)) {
        if (field in body && typeof body[field] === "number") {
          await db.insert(appSettings).values({ key: settingKey, value: body[field] }).onConflictDoUpdate({ target: appSettings.key, set: { value: body[field] } });
          setSetting(settingKey, body[field]);
        }
      }
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/settings/ai/test-connection",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      res.json(await testConnection());
    }),
  );

  app.get("/api/settings/ai/cache", requireAuth, asyncHandler(async (_req, res) => {
    res.json(await cacheStats());
  }));

  app.delete(
    "/api/settings/ai/cache",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const cleared = await clearCache();
      const actorId = (req.user as User | undefined)?.id ?? null;
      await appendAudit({
        actorId,
        action: "cache_cleared",
        entityType: "llm_cache",
        entityId: "all",
        after: { cleared },
        rationale: "Admin cleared the inference cache.",
        source: "steward",
      });
      res.json({ cleared });
    }),
  );

  // Update a scalar app setting (e.g. confidence_review_threshold).
  app.put(
    "/api/settings/:key",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const key = String(req.params.key);
      if (!("value" in (req.body ?? {}))) throw new HttpError(400, "Body must include `value`.");
      const value = req.body.value;

      await db
        .insert(appSettings)
        .values({ key, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value } });

      setSetting(key, value);
      res.json({ key, value });
    }),
  );
}
