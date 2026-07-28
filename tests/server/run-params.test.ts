import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { pool, db } from "../../server/db";
import { assets, attributes, detections } from "@shared/models/schema";
import { CRITERION_CODES } from "@shared/lib/criteria";
import { seedReferenceData } from "../../server/seed";
import { createEngineRun } from "../../server/engine/runs";
import { inferPiiForAttribute, type InferContext, type PiiAssessment } from "../../server/engine/infer";
import type { DetectionInput } from "../../server/pii-engine/types";

const stub = async (): Promise<PiiAssessment> => ({
  verdict: "pii", suggestedDataClass: "EMIRATES_ID", overallConfidence: 0.9,
  rationaleEn: "r", rationaleAr: "ر", metadataConflict: false,
  criteria: CRITERION_CODES.map((code) => ({ code, applies: code === "DIRECT_ID", rationaleEn: "x", rationaleAr: "ي", confidence: 0.8 })),
});

function makeInput(): DetectionInput {
  return {
    attribute: {
      id: 1, assetId: 1, columnName: "national_id", descriptionEn: "d", descriptionAr: "",
      dataType: "VARCHAR", nativeType: "text", isPrimaryKey: false, nullable: true,
      selectedDataClassName: null, selectedDataClassConfidence: null, suggestedClasses: null,
      columnDataClassification: null, piiName: null, piiDescription: null, cdeFlag: false,
      rawRow: null, ingestRunId: null,
    } as unknown as DetectionInput["attribute"],
    asset: { id: 1, name: "People", assetType: "table", businessDomain: "HR", subjectArea: "Person" },
    siblingColumnNames: ["a", "b"],
  };
}

const baseCtx: InferContext = {
  modelId: "m", promptVersion: "p@1", frameworkVersion: "fw-1", frameworkVersionId: null,
  engineVersion: "0.1.0", activeCriteria: [...CRITERION_CODES], useCache: false, forceFresh: false,
  systemPrompt: "sys", threshold: 0.6, seed: 42, selfConsistencySamples: 1, confidenceFloor: 0.3, includeArabic: true,
};

describe("self-consistency samples drive the number of model calls (DB-free)", () => {
  it("selfConsistencySamples = 1 → one model call", async () => {
    let calls = 0;
    await inferPiiForAttribute(makeInput(), { ...baseCtx, selfConsistencySamples: 1 }, {
      infer: async () => { calls++; return stub(); },
    });
    expect(calls).toBe(1);
  });

  it("selfConsistencySamples = 4 → four model calls with distinct seeds", async () => {
    let calls = 0;
    const seeds: number[] = [];
    await inferPiiForAttribute(makeInput(), { ...baseCtx, selfConsistencySamples: 4 }, {
      infer: async (_p, _s, seed) => { calls++; seeds.push(seed ?? -1); return stub(); },
    });
    expect(calls).toBe(4);
    expect(new Set(seeds).size).toBe(4); // §7.4: N varied seeds
  });
});

// End-to-end: prove a RUN's params.selfConsistencySamples actually reaches the model layer
// (params → processRun → InferContext → inferPiiForAttribute). Needs Postgres; skips otherwise.
const dbAvailable = await pool.query("SELECT 1").then(() => true).catch(() => false);

describe.runIf(dbAvailable)("run params → engine (self-consistency end-to-end)", () => {
  let attrId = 0;
  beforeAll(async () => {
    await seedReferenceData();
    const [asset] = await db.insert(assets).values({ ikcAssetId: `TEST_PARAMS_${Date.now()}`, name: "Params Test" }).returning();
    const [attr] = await db.insert(attributes).values({ assetId: asset.id, columnName: "national_id" }).returning();
    attrId = attr.id;
  });

  it("params.selfConsistencySamples = 3 makes the engine call the model 3× for one column", async () => {
    let calls = 0;
    const run = await createEngineRun(
      {
        engineType: "pii",
        screen: "attributes",
        selection: { mode: "include", ids: [attrId] },
        params: { selfConsistencySamples: 3, useCache: false, skipApproved: false },
      },
      null,
      { infer: async () => { calls++; return stub(); } },
    );
    expect(run.status).toBe("completed");
    expect(calls).toBe(3); // one column × 3 samples — proves the param flows all the way through
  });

  it("params.selfConsistencySamples = 1 (default) makes exactly one call", async () => {
    let calls = 0;
    await db.delete(detections).where(eq(detections.attributeId, attrId));
    await createEngineRun(
      {
        engineType: "pii",
        screen: "attributes",
        selection: { mode: "include", ids: [attrId] },
        params: { selfConsistencySamples: 1, useCache: false, skipApproved: false },
      },
      null,
      { infer: async () => { calls++; return stub(); } },
    );
    expect(calls).toBe(1);
  });
});
