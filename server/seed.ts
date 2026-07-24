/**
 * Idempotent reference-data seeding. Runs once on boot inside registerRoutes().
 *
 * Strategy:
 *   1. Populate the in-memory cache from static definitions — always succeeds so
 *      the engines have criteria / levels / prompts / rules even with no DB.
 *   2. Best-effort persist to Postgres (ON CONFLICT DO NOTHING) and re-hydrate the
 *      cache from the DB so steward edits (prompts, thresholds) survive restarts.
 */
import { db } from "./db";
import {
  users,
  appSettings,
  systemPrompts,
  policyCriteria,
  classificationLevels,
  dataClasses,
} from "@shared/models/schema";
import { POLICY_CRITERIA_LIST } from "@shared/lib/criteria";
import { CLASSIFICATION_LEVELS_LIST } from "@shared/lib/classification";
import { SEED_PROMPTS, SEED_DATA_CLASSES, SEED_APP_SETTINGS } from "./seed-data";
import { DEFAULT_CLASSIFICATION_RULES } from "./classification-engine/attribute-rules";
import { hashPassword } from "./auth";
import { setPrompt, setSetting, setDataClasses } from "./reference-cache";
import { ensureFramework } from "./frameworks/store";
import { log } from "./vite";

export const DEFAULT_ADMIN = {
  username: "admin",
  password: "admin123",
  role: "admin" as const,
};

export async function seedReferenceData(): Promise<void> {
  // 1) Static definitions -> cache.
  for (const prompt of SEED_PROMPTS) setPrompt(prompt);
  setDataClasses(SEED_DATA_CLASSES);
  for (const setting of SEED_APP_SETTINGS) setSetting(setting.key, setting.value);
  setSetting("classification_rules", DEFAULT_CLASSIFICATION_RULES);

  // 2) Persist + hydrate (best effort).
  try {
    await persist();
    await ensureFramework("pii");
    await ensureFramework("classification");
    await hydrate();
    log("reference data seeded");
  } catch (err) {
    log(`DB unavailable — using in-memory reference data only (${(err as Error).message})`);
  }
}

async function persist(): Promise<void> {
  const passwordHash = await hashPassword(DEFAULT_ADMIN.password);
  await db
    .insert(users)
    .values({ username: DEFAULT_ADMIN.username, passwordHash, role: DEFAULT_ADMIN.role })
    .onConflictDoNothing();

  await db
    .insert(appSettings)
    .values([
      ...SEED_APP_SETTINGS.map((s) => ({ key: s.key, value: s.value })),
      { key: "classification_rules", value: DEFAULT_CLASSIFICATION_RULES },
    ])
    .onConflictDoNothing();

  await db
    .insert(systemPrompts)
    .values(SEED_PROMPTS.map((p) => ({ key: p.key, label: p.label, content: p.content })))
    .onConflictDoNothing();

  await db
    .insert(policyCriteria)
    .values(
      POLICY_CRITERIA_LIST.map((c) => ({
        code: c.code,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        description: c.description,
        evaluationMode: c.evaluationMode,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(classificationLevels)
    .values(
      CLASSIFICATION_LEVELS_LIST.map((l) => ({
        code: l.code,
        label: l.labelEn,
        rank: l.rank,
        colorToken: l.colorToken,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(dataClasses)
    .values(
      SEED_DATA_CLASSES.map((d) => ({
        code: d.code,
        nameEn: d.nameEn,
        nameAr: d.nameAr,
        category: d.category,
        isPii: d.isPii,
        isSpecialCategory: d.isSpecialCategory,
        detectionHints: d.detectionHints,
        source: d.source,
        active: d.active,
      })),
    )
    .onConflictDoNothing();
}

async function hydrate(): Promise<void> {
  const promptRows = await db.select().from(systemPrompts);
  for (const row of promptRows) {
    setPrompt({ key: row.key, label: row.label, content: row.content });
  }

  const settingRows = await db.select().from(appSettings);
  for (const row of settingRows) setSetting(row.key, row.value);

  const classRows = await db.select().from(dataClasses);
  if (classRows.length > 0) {
    setDataClasses(
      classRows.map((r) => ({
        code: r.code,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        category: r.category,
        isPii: r.isPii,
        isSpecialCategory: r.isSpecialCategory,
        detectionHints: r.detectionHints,
        source: r.source,
        active: r.active,
      })),
    );
  }
}
