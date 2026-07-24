/**
 * Commit preview for wizard step 3 (Prompt 2 §6.3) — a read-only summary of exactly
 * what the approval transaction WILL change. Computes nothing to the catalog.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { attributes, engineRuns, runItems } from "@shared/models/schema";
import { rollupLevel, type ClassificationCode } from "@shared/lib/classification";
import { frameworkVersionLabel } from "../frameworks/store";

export interface CommitDiffRow {
  targetId: number;
  columnName: string;
  field: string;
  currentValue: string;
  newValue: string;
  source: string;
}

export interface AssetRollupPreview {
  assetId: number;
  currentLevel: string;
  newLevel: string;
  driver: string;
}

export interface CommitPreview {
  runId: number;
  engineType: string;
  markedPii: number;
  markedNotPii: number;
  uncertainQueued: number;
  unchanged: number;
  diffs: CommitDiffRow[];
  assetRollups: AssetRollupPreview[];
  frameworkVersion: string | null;
  engineVersion: string | null;
  modelId: string | null;
  promptVersion: string | null;
}

export async function getCommitPreview(runId: number): Promise<CommitPreview> {
  const [run] = await db.select().from(engineRuns).where(eq(engineRuns.id, runId)).limit(1);
  if (!run) throw Object.assign(new Error("Engine run not found."), { status: 404 });

  const items = await db.select().from(runItems).where(eq(runItems.runId, runId));
  const attrIds = items.map((i) => i.targetId);
  const attrRows = attrIds.length ? await db.select().from(attributes).where(inArray(attributes.id, attrIds)) : [];
  const attrMap = new Map(attrRows.map((a) => [a.id, a]));

  const preview: CommitPreview = {
    runId,
    engineType: run.engineType,
    markedPii: 0,
    markedNotPii: 0,
    uncertainQueued: 0,
    unchanged: 0,
    diffs: [],
    assetRollups: [],
    frameworkVersion: await frameworkVersionLabel(run.engineType, run.frameworkVersionId),
    engineVersion: run.engineVersion,
    modelId: run.modelId,
    promptVersion: run.promptVersion,
  };

  // Simulate per-attribute new levels for the rollup preview.
  const newLevelByAttr = new Map<number, ClassificationCode | null>();
  const assetIds = new Set<number>();

  for (const item of items) {
    const attr = attrMap.get(item.targetId);
    if (!attr) continue;
    assetIds.add(attr.assetId);
    const applying = item.stewardDecision === "accept" || item.stewardDecision === "override";

    if (item.stewardDecision === "pending" || item.verdict === "uncertain") preview.uncertainQueued++;
    else if (!applying) preview.unchanged++;

    if (run.engineType === "pii" && applying) {
      const verdict = (item.overrideValue?.verdict as string) ?? item.verdict;
      if (verdict === "pii") preview.markedPii++;
      else if (verdict === "not_pii") preview.markedNotPii++;
      preview.diffs.push({
        targetId: attr.id,
        columnName: attr.columnName,
        field: "PII Name",
        currentValue: attr.piiName ?? "—",
        newValue: verdict === "pii" ? item.suggestedClassCode ?? "PII" : "—",
        source: item.stewardDecision,
      });
    }

    if (run.engineType === "classification" && applying) {
      const level = ((item.overrideValue?.levelCode as ClassificationCode) ?? item.suggestedLevelCode) as ClassificationCode | null;
      newLevelByAttr.set(attr.id, level ?? attr.columnDataClassification ?? null);
      if (level && level !== attr.columnDataClassification) {
        preview.diffs.push({
          targetId: attr.id,
          columnName: attr.columnName,
          field: "Classification",
          currentValue: attr.columnDataClassification ?? "Unclassified",
          newValue: level,
          source: item.stewardDecision,
        });
      }
    }
  }

  if (run.engineType === "classification") {
    for (const assetId of assetIds) {
      const assetAttrs = attrRows.filter((a) => a.assetId === assetId);
      const currentLevels = assetAttrs.map((a) => a.columnDataClassification).filter((l): l is ClassificationCode => !!l);
      const newLevels = assetAttrs.map((a) => newLevelByAttr.get(a.id) ?? a.columnDataClassification).filter((l): l is ClassificationCode => !!l);
      const current = rollupLevel(currentLevels);
      const next = rollupLevel(newLevels);
      if (next && next !== current) {
        const driver = assetAttrs.find((a) => (newLevelByAttr.get(a.id) ?? a.columnDataClassification) === next);
        preview.assetRollups.push({
          assetId,
          currentLevel: current ?? "Unclassified",
          newLevel: next,
          driver: driver?.columnName ?? "—",
        });
      }
    }
  }

  return preview;
}
