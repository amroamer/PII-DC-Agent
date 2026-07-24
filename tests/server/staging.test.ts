import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { pool, db } from "../../server/db";
import { assets, attributes, detections } from "@shared/models/schema";
import { CRITERION_CODES } from "@shared/lib/criteria";
import { seedReferenceData } from "../../server/seed";
import { createEngineRun } from "../../server/engine/runs";
import { approveRun } from "../../server/engine/approve";
import type { PiiAssessment } from "../../server/engine/infer";

// These exercise the real transactional catalog writes, so they need Postgres.
// They run when DATABASE_URL points at a reachable DB and skip cleanly otherwise.
const dbAvailable = await pool
  .query("SELECT 1")
  .then(() => true)
  .catch(() => false);

const stub = async (): Promise<PiiAssessment> => ({
  verdict: "pii",
  suggestedDataClass: "EMIRATES_ID",
  overallConfidence: 0.9,
  rationaleEn: "r",
  rationaleAr: "ر",
  criteria: CRITERION_CODES.map((code) => ({ code, applies: code === "DIRECT_ID", rationaleEn: "x", rationaleAr: "ي", confidence: 0.8 })),
});

async function countDetections(attributeId: number): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(detections).where(eq(detections.attributeId, attributeId));
  return row?.n ?? 0;
}

describe.runIf(dbAvailable)("staging isolation + approval transaction (§13.4/§13.5)", () => {
  let attrId = 0;

  beforeAll(async () => {
    await seedReferenceData();
    const [asset] = await db.insert(assets).values({ ikcAssetId: `TEST_STAGING_${Date.now()}`, name: "Test Asset" }).returning();
    const [attr] = await db.insert(attributes).values({ assetId: asset.id, columnName: "national_id" }).returning();
    attrId = attr.id;
  });

  it("a completed-but-unapproved run leaves the catalog unchanged; approval commits it", async () => {
    const before = await countDetections(attrId);

    const run = await createEngineRun(
      { engineType: "pii", screen: "attributes", selection: { mode: "include", ids: [attrId] }, params: {} },
      null,
      { infer: stub },
    );
    expect(run.status).toBe("completed");
    expect(await countDetections(attrId)).toBe(before); // staging only — catalog untouched

    const result = await approveRun(run.id, "Approving for the staging isolation test.", null);
    expect(result.detectionsWritten).toBeGreaterThan(0);
    expect(await countDetections(attrId)).toBe(before + result.detectionsWritten);
  });

  it("re-approving an approved run throws and writes nothing further", async () => {
    const run = await createEngineRun(
      { engineType: "pii", screen: "attributes", selection: { mode: "include", ids: [attrId] }, params: {} },
      null,
      { infer: stub },
    );
    await approveRun(run.id, "First approval of the rollback test.", null);
    const after = await countDetections(attrId);

    await expect(approveRun(run.id, "Second approval must fail.", null)).rejects.toThrow();
    expect(await countDetections(attrId)).toBe(after);
  });
});
