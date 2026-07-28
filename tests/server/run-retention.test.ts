import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { pool, db } from "../../server/db";
import { assets, attributes, criterionAssessments, detections, engineRuns, runItems } from "@shared/models/schema";
import { seedReferenceData } from "../../server/seed";
import { pruneOldRuns } from "../../server/engine/runs";
import { setSetting } from "../../server/reference-cache";

const DAY = 24 * 60 * 60 * 1000;

afterEach(() => setSetting("engine_runs_retention_days", undefined));

describe("pruneOldRuns — retention guard (DB-free)", () => {
  it("does nothing (returns 0) when retention is disabled (<= 0)", async () => {
    for (const v of [0, -5]) {
      setSetting("engine_runs_retention_days", v);
      expect(await pruneOldRuns()).toBe(0);
    }
  });

  it("does nothing when the setting is not a finite number", async () => {
    setSetting("engine_runs_retention_days", "ninety" as unknown as number);
    expect(await pruneOldRuns()).toBe(0);
  });
});

// End-to-end: prune deletes old runs + scaffolding but preserves committed catalog data.
// Needs Postgres; skips cleanly otherwise (same pattern as the staging tests).
const dbAvailable = await pool.query("SELECT 1").then(() => true).catch(() => false);

describe.runIf(dbAvailable)("pruneOldRuns — end-to-end", () => {
  let assetId = 0;
  let attrId = 0;
  let oldRunId = 0;
  let newRunId = 0;
  let runningRunId = 0;

  beforeAll(async () => {
    await seedReferenceData();
    const [asset] = await db.insert(assets).values({ ikcAssetId: `TEST_RETENTION_${Date.now()}`, name: "Retention Test" }).returning();
    assetId = asset.id;
    const [attr] = await db.insert(attributes).values({ assetId, columnName: "national_id" }).returning();
    attrId = attr.id;

    const old = new Date(Date.now() - 200 * DAY);
    const base = { engineType: "pii" as const, scopeSelection: {}, params: {} };

    // Old, terminal → should be pruned.
    [{ id: oldRunId }] = await db.insert(engineRuns).values({ ...base, status: "completed", startedAt: old, completedAt: old }).returning({ id: engineRuns.id });
    const [item] = await db.insert(runItems).values({ runId: oldRunId, targetType: "attribute", targetId: attrId }).returning();
    await db.insert(criterionAssessments).values({ runItemId: item.id, criterionCode: "DIRECT_ID" });
    // Committed catalog verdict tagged with the old run id — must SURVIVE pruning.
    await db.insert(detections).values({ attributeId: attrId, layer: "llm", verdict: "pii", engineVersion: "0.1.0", runId: String(oldRunId) });

    // Recent terminal run → should be kept.
    [{ id: newRunId }] = await db.insert(engineRuns).values({ ...base, status: "completed", startedAt: new Date(), completedAt: new Date() }).returning({ id: engineRuns.id });
    // Old but still 'running' → must be spared (never delete an in-flight run).
    [{ id: runningRunId }] = await db.insert(engineRuns).values({ ...base, status: "running", startedAt: old }).returning({ id: engineRuns.id });
  });

  afterAll(async () => {
    const runIds = [oldRunId, newRunId, runningRunId];
    await db.delete(detections).where(eq(detections.attributeId, attrId));
    const leftoverItems = await db.select({ id: runItems.id }).from(runItems).where(inArray(runItems.runId, runIds));
    if (leftoverItems.length) {
      await db.delete(criterionAssessments).where(inArray(criterionAssessments.runItemId, leftoverItems.map((i) => i.id)));
    }
    await db.delete(runItems).where(inArray(runItems.runId, runIds));
    await db.delete(engineRuns).where(inArray(engineRuns.id, runIds));
    await db.delete(attributes).where(eq(attributes.id, attrId));
    await db.delete(assets).where(eq(assets.id, assetId));
  });

  it("deletes the old run + its scaffolding, keeps recent & running runs, preserves the catalog", async () => {
    setSetting("engine_runs_retention_days", 90);
    const deleted = await pruneOldRuns();
    expect(deleted).toBeGreaterThanOrEqual(1);

    // Old run and its children are gone.
    expect(await db.select().from(engineRuns).where(eq(engineRuns.id, oldRunId))).toHaveLength(0);
    expect(await db.select().from(runItems).where(eq(runItems.runId, oldRunId))).toHaveLength(0);

    // Committed catalog detection SURVIVES (referenced the run only by text runId).
    expect(await db.select().from(detections).where(eq(detections.attributeId, attrId))).toHaveLength(1);

    // Recent run kept; old-but-running run spared.
    expect(await db.select().from(engineRuns).where(eq(engineRuns.id, newRunId))).toHaveLength(1);
    expect(await db.select().from(engineRuns).where(eq(engineRuns.id, runningRunId))).toHaveLength(1);
  });
});
