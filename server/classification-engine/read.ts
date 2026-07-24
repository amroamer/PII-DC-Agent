/**
 * Read side of the classification engine: the active attribute-level and
 * asset-level classifications with their target context, for the Classification
 * page.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  assets,
  attributes,
  classifications,
  type Classification,
} from "@shared/models/schema";
import type { ClassificationCode } from "@shared/lib/classification";

async function activeByScope(scope: "attribute" | "asset"): Promise<Classification[]> {
  return db
    .select()
    .from(classifications)
    .where(and(eq(classifications.scope, scope), isNull(classifications.supersededBy)))
    .orderBy(desc(classifications.createdAt));
}

export interface AttributeClassificationRow {
  attributeId: number;
  columnName: string;
  assetId: number;
  assetName: string;
  levelCode: ClassificationCode;
  derivedFrom: Classification["derivedFrom"];
  rationale: string | null;
  createdAt: Date;
}

export async function getAttributeClassifications(): Promise<AttributeClassificationRow[]> {
  const rows = await activeByScope("attribute");
  if (rows.length === 0) return [];

  const attrIds = rows.map((r) => r.targetId);
  const attrRows = await db.select().from(attributes).where(inArray(attributes.id, attrIds));
  const attrMap = new Map(attrRows.map((a) => [a.id, a]));
  const assetIds = [...new Set(attrRows.map((a) => a.assetId))];
  const assetRows = assetIds.length
    ? await db.select().from(assets).where(inArray(assets.id, assetIds))
    : [];
  const assetMap = new Map(assetRows.map((a) => [a.id, a]));

  return rows
    .map((r) => {
      const attr = attrMap.get(r.targetId);
      if (!attr) return null;
      const asset = assetMap.get(attr.assetId);
      return {
        attributeId: attr.id,
        columnName: attr.columnName,
        assetId: attr.assetId,
        assetName: asset?.name ?? "(unknown asset)",
        levelCode: r.levelCode,
        derivedFrom: r.derivedFrom,
        rationale: r.rationale,
        createdAt: r.createdAt,
      };
    })
    .filter((r): r is AttributeClassificationRow => r !== null);
}

export interface AssetClassificationRow {
  assetId: number;
  assetName: string;
  levelCode: ClassificationCode;
  derivedFrom: Classification["derivedFrom"];
  rationale: string | null;
  piiFlag: boolean;
  cdeFlag: boolean;
  createdAt: Date;
}

export async function getAssetClassifications(): Promise<AssetClassificationRow[]> {
  const rows = await activeByScope("asset");
  if (rows.length === 0) return [];

  const assetIds = rows.map((r) => r.targetId);
  const assetRows = await db.select().from(assets).where(inArray(assets.id, assetIds));
  const assetMap = new Map(assetRows.map((a) => [a.id, a]));

  return rows
    .map((r) => {
      const asset = assetMap.get(r.targetId);
      if (!asset) return null;
      return {
        assetId: asset.id,
        assetName: asset.name,
        levelCode: r.levelCode,
        derivedFrom: r.derivedFrom,
        rationale: r.rationale,
        piiFlag: asset.piiFlag,
        cdeFlag: asset.cdeFlag,
        createdAt: r.createdAt,
      };
    })
    .filter((r): r is AssetClassificationRow => r !== null);
}
