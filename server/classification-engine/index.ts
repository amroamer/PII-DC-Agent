/**
 * Classification Engine orchestrator: attribute pass (rule table) then asset
 * rollup pass (high-water-mark). Reads the fused PII verdicts from the detection
 * engine's read side so the two engines stay decoupled.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { assets, attributes, type Attribute } from "@shared/models/schema";
import { getClassificationRules, getDataClasses } from "../reference-cache";
import { getLatestRunId, getResults } from "../pii-engine/results";
import { classifyByRules } from "./attribute-rules";
import { rollupAssetLevel, type AttrLevel } from "./rollup";
import { writeComputedClassification } from "./store";
import { computeAndStoreCompletion } from "./completion";

export interface ClassificationRunResult {
  runId: string | null;
  attributesClassified: number;
  assetsClassified: number;
  overrideDivergences: number;
}

export async function runClassification(runId?: string): Promise<ClassificationRunResult> {
  const results = await getResults({ runId });
  const usedRunId = runId ?? (await getLatestRunId());

  if (results.length === 0) {
    return { runId: usedRunId, attributesClassified: 0, assetsClassified: 0, overrideDivergences: 0 };
  }

  const attrRows = await db.select().from(attributes);
  const attrMap = new Map<number, Attribute>(attrRows.map((a) => [a.id, a]));
  const rules = getClassificationRules();
  const specialCodes = new Set(getDataClasses().filter((d) => d.isSpecialCategory).map((d) => d.code));

  const levelsByAsset = new Map<number, AttrLevel[]>();
  let attributesClassified = 0;
  let overrideDivergences = 0;

  // --- attribute pass -------------------------------------------------------
  for (const r of results) {
    const attr = attrMap.get(r.attributeId);
    if (!attr) continue;

    const isSpecialCategory =
      r.merged.criterion === "SPECIAL_CATEGORY" ||
      (r.merged.dataClassCode ? specialCodes.has(r.merged.dataClassCode) : false);

    const ruleResult = classifyByRules(
      {
        verdict: r.merged.verdict,
        criterion: r.merged.criterion,
        isSpecialCategory,
        existingLevel: attr.columnDataClassification ?? null,
      },
      rules,
    );

    const rationale = `${ruleResult.note} (verdict=${r.merged.verdict}, criterion=${r.merged.criterion ?? "n/a"}${attr.columnDataClassification ? `, IKC floor=${attr.columnDataClassification}` : ""}).`;

    const write = await writeComputedClassification({
      scope: "attribute",
      targetId: r.attributeId,
      level: ruleResult.level,
      derivedFrom: "engine",
      rationale,
    });
    if (write.diverged) overrideDivergences++;

    const list = levelsByAsset.get(attr.assetId) ?? [];
    list.push({ attributeId: r.attributeId, columnName: r.columnName, level: write.effectiveLevel });
    levelsByAsset.set(attr.assetId, list);

    attributesClassified++;
    await computeAndStoreCompletion(attr);
  }

  // --- asset rollup pass ----------------------------------------------------
  let assetsClassified = 0;
  for (const [assetId, attrLevels] of levelsByAsset) {
    const { level, drivers } = rollupAssetLevel(attrLevels);
    if (!level) continue;

    const write = await writeComputedClassification({
      scope: "asset",
      targetId: assetId,
      level,
      derivedFrom: "rollup",
      rationale: `Asset inherits ${level} (high-water-mark) from attribute(s): ${drivers.join(", ")}.`,
    });
    if (write.diverged) overrideDivergences++;

    // Roll up the asset-level PII + CDE flags the same way.
    const assetAttrs = attrRows.filter((a) => a.assetId === assetId);
    const anyPii = results.some((r) => r.assetId === assetId && r.merged.verdict === "pii");
    const anyCde = assetAttrs.some((a) => a.cdeFlag);

    await db
      .update(assets)
      .set({ piiFlag: anyPii, cdeFlag: anyCde, assetClassification: write.effectiveLevel })
      .where(eq(assets.id, assetId));

    assetsClassified++;
  }

  return { runId: usedRunId, attributesClassified, assetsClassified, overrideDivergences };
}
