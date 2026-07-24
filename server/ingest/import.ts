import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { assets, attributes, ingestRuns, type IngestRun } from "@shared/models/schema";
import type { IkcSheetType } from "@shared/lib/ikc-fields";
import { invalidateDistinctCache } from "../catalog/query";
import {
  asBool,
  asClassification,
  asInt,
  asNumber,
  asRawNumber,
  asString,
  asStringArray,
  mapRow,
} from "./parse";

export interface ImportRequest {
  filename: string;
  sheetType: IkcSheetType;
  mapping: Record<string, string | null>;
  rows: Record<string, unknown>[];
}

export interface ImportSummary {
  runId: number;
  sheetType: IkcSheetType;
  filename: string;
  rowCount: number;
  assetsCreated: number;
  assetsUpdated: number;
  attributesCreated: number;
  skipped: number;
  warnings: string[];
}

export async function runImport(req: ImportRequest): Promise<ImportSummary> {
  const [run] = await db
    .insert(ingestRuns)
    .values({
      filename: req.filename,
      sheetType: req.sheetType,
      rowCount: req.rows.length,
      status: "importing",
    })
    .returning();

  const summary: ImportSummary = {
    runId: run.id,
    sheetType: req.sheetType,
    filename: req.filename,
    rowCount: req.rows.length,
    assetsCreated: 0,
    assetsUpdated: 0,
    attributesCreated: 0,
    skipped: 0,
    warnings: [],
  };

  try {
    if (req.sheetType === "asset") {
      await importAssets(req, run.id, summary);
    } else {
      await importAttributes(req, run.id, summary);
    }
    await db
      .update(ingestRuns)
      .set({ status: "completed", finishedAt: new Date() })
      .where(eq(ingestRuns.id, run.id));
    // Distinct filter-option lists (domains, storage, …) may have changed.
    invalidateDistinctCache();
  } catch (err) {
    await db
      .update(ingestRuns)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(ingestRuns.id, run.id));
    throw err;
  }

  return summary;
}

async function importAssets(
  req: ImportRequest,
  runId: number,
  summary: ImportSummary,
): Promise<void> {
  for (const raw of req.rows) {
    const m = mapRow(raw, req.mapping);
    const ikcAssetId = asString(m.ikcAssetId);
    const name = asString(m.name) ?? ikcAssetId;
    if (!ikcAssetId || !name) {
      summary.skipped++;
      summary.warnings.push("Asset row skipped: missing Asset ID or Name.");
      continue;
    }

    const values = {
      ikcAssetId,
      name,
      descriptionEn: asString(m.descriptionEn),
      descriptionAr: asString(m.descriptionAr),
      assetType: asString(m.assetType),
      businessDomain: asString(m.businessDomain),
      subjectArea: asString(m.subjectArea),
      department: asString(m.department),
      sector: asString(m.sector),
      ownerId: asString(m.owner),
      stewards: asString(m.stewards),
      storage: asString(m.storage),
      retentionPeriod: asString(m.retentionPeriod),
      piiFlag: asBool(m.piiFlag),
      cdeFlag: asBool(m.cdeFlag),
      assetClassification: asClassification(m.assetClassification),
      catalogId: asString(m.catalogId),
      creatorId: asString(m.creatorId),
      tableType: asString(m.tableType),
      tableSchema: asString(m.tableSchema),
      connectionId: asString(m.connectionId),
      connectionPath: asString(m.connectionPath),
      backupFrequency: asString(m.backupFrequency),
      numColumns: asInt(m.numColumns),
      numChildren: asInt(m.numChildren),
      qualityScore: asRawNumber(m.qualityScore),
      analysedRowCount: asInt(m.analysedRowCount),
      rawRow: raw as Record<string, unknown>,
      ingestRunId: runId,
    };

    const [existing] = await db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.ikcAssetId, ikcAssetId))
      .limit(1);

    if (existing) {
      const { ikcAssetId: _omit, ...updatable } = values;
      await db.update(assets).set(updatable).where(eq(assets.id, existing.id));
      summary.assetsUpdated++;
    } else {
      await db.insert(assets).values(values);
      summary.assetsCreated++;
    }
  }
}

async function importAttributes(
  req: ImportRequest,
  runId: number,
  summary: ImportSummary,
): Promise<void> {
  const assetIdByKey = new Map<string, number>();

  for (const raw of req.rows) {
    const m = mapRow(raw, req.mapping);
    const columnName = asString(m.columnName);
    if (!columnName) {
      summary.skipped++;
      summary.warnings.push("Attribute row skipped: missing Column Name.");
      continue;
    }

    const parentKey = asString(m.ikcAssetId) ?? "__UNASSIGNED__";
    let assetId = assetIdByKey.get(parentKey);
    if (assetId === undefined) {
      assetId = await ensureAsset(parentKey, asString(m.assetName), runId, summary);
      assetIdByKey.set(parentKey, assetId);
    }

    await db.insert(attributes).values({
      assetId,
      columnName,
      descriptionEn: asString(m.descriptionEn),
      descriptionAr: asString(m.descriptionAr),
      dataType: asString(m.dataType),
      nativeType: asString(m.nativeType),
      isPrimaryKey: asBool(m.isPrimaryKey),
      nullable: m.nullable == null ? true : asBool(m.nullable),
      selectedDataClassName: asString(m.selectedDataClassName),
      selectedDataClassConfidence: asNumber(m.selectedDataClassConfidence),
      suggestedClasses: asStringArray(m.suggestedClasses),
      columnDataClassification: asClassification(m.columnDataClassification),
      piiName: asString(m.piiName),
      piiDescription: asString(m.piiDescription),
      cdeFlag: asBool(m.cdeFlag),
      length: asInt(m.length),
      scale: asInt(m.scale),
      signed: m.signed == null ? null : asBool(m.signed),
      qualityScore: asRawNumber(m.qualityScore),
      rawRow: raw as Record<string, unknown>,
      ingestRunId: runId,
    });
    summary.attributesCreated++;
  }
}

async function ensureAsset(
  ikcAssetId: string,
  assetName: string | null,
  runId: number,
  summary: ImportSummary,
): Promise<number> {
  const [existing] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.ikcAssetId, ikcAssetId))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(assets)
    .values({ ikcAssetId, name: assetName ?? ikcAssetId, ingestRunId: runId })
    .onConflictDoNothing()
    .returning();
  if (created) {
    summary.assetsCreated++;
    return created.id;
  }

  const [again] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.ikcAssetId, ikcAssetId))
    .limit(1);
  return again.id;
}

// --- read helpers for the routes -------------------------------------------

export async function listIngestRuns(): Promise<IngestRun[]> {
  return db.select().from(ingestRuns).orderBy(sql`${ingestRuns.startedAt} DESC`).limit(50);
}

export async function getIngestRun(id: number): Promise<IngestRun | undefined> {
  const [row] = await db.select().from(ingestRuns).where(eq(ingestRuns.id, id)).limit(1);
  return row;
}

export async function getRunCounts(
  runId: number,
): Promise<{ assets: number; attributes: number }> {
  const [assetCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assets)
    .where(eq(assets.ingestRunId, runId));
  const [attrCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attributes)
    .where(eq(attributes.ingestRunId, runId));
  return { assets: assetCount?.n ?? 0, attributes: attrCount?.n ?? 0 };
}
