/**
 * Metadata completion. The policy mandates SEVEN required metadata attributes per
 * tagged element. Five come from IKC (source system, owner/steward, classification,
 * retention period, access control) and two must be captured inside PDTC
 * (processing purpose, consent status) — the fields IKC has no native home for.
 * Feeds the Coverage dashboard.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  assets,
  attributes,
  classifications,
  metadataCompletion,
  type Asset,
  type Attribute,
  type MetadataCompletion,
} from "@shared/models/schema";

export interface RequiredMetadataField {
  key: string;
  labelEn: string;
  labelAr: string;
  providedBy: "ikc" | "pdtc";
}

export const REQUIRED_METADATA: RequiredMetadataField[] = [
  { key: "sourceSystem", labelEn: "Source System", labelAr: "النظام المصدر", providedBy: "ikc" },
  { key: "ownerSteward", labelEn: "Owner / Steward", labelAr: "المالك / أمين البيانات", providedBy: "ikc" },
  { key: "classification", labelEn: "Classification", labelAr: "التصنيف", providedBy: "ikc" },
  { key: "retentionPeriod", labelEn: "Retention Period", labelAr: "مدة الاحتفاظ", providedBy: "ikc" },
  { key: "accessControl", labelEn: "Access Control", labelAr: "التحكم في الوصول", providedBy: "pdtc" },
  { key: "processingPurpose", labelEn: "Processing Purpose", labelAr: "غرض المعالجة", providedBy: "pdtc" },
  { key: "consentStatus", labelEn: "Consent Status", labelAr: "حالة الموافقة", providedBy: "pdtc" },
];

export interface FieldStatus extends RequiredMetadataField {
  present: boolean;
}

export function computeAttributeCompletion(
  attr: Attribute,
  asset: Asset | undefined,
  hasClassification: boolean,
  completion: MetadataCompletion | undefined,
): FieldStatus[] {
  const present: Record<string, boolean> = {
    sourceSystem: Boolean(asset?.storage),
    ownerSteward: Boolean(asset?.ownerId || asset?.stewards),
    classification: hasClassification || Boolean(attr.columnDataClassification),
    retentionPeriod: Boolean(asset?.retentionPeriod),
    accessControl: Boolean(completion?.accessControlLevel),
    processingPurpose: Boolean(completion?.processingPurpose),
    consentStatus: Boolean(completion?.consentStatus),
  };
  return REQUIRED_METADATA.map((f) => ({ ...f, present: present[f.key] ?? false }));
}

/** Idempotently ensure a metadata_completion row exists for an attribute. */
export async function computeAndStoreCompletion(attr: Attribute): Promise<void> {
  const [existing] = await db
    .select()
    .from(metadataCompletion)
    .where(eq(metadataCompletion.attributeId, attr.id))
    .limit(1);
  if (!existing) {
    await db.insert(metadataCompletion).values({ attributeId: attr.id });
  }
}

export interface CompletionRow {
  attributeId: number;
  columnName: string;
  assetName: string;
  fields: FieldStatus[];
  completeCount: number;
  totalCount: number;
}

export interface CompletionReport {
  rows: CompletionRow[];
  summary: {
    attributes: number;
    fullyComplete: number;
    missingPdtcFields: number;
    incompleteTotal: number;
    fieldTotals: Record<string, { present: number; total: number }>;
  };
}

/** The dashboard lists a sample of incomplete rows; summary counts cover all. */
const COMPLETION_ROW_CAP = 500;

export async function getCompletionReport(): Promise<CompletionReport> {
  const attrRows = await db.select().from(attributes);
  if (attrRows.length === 0) {
    return {
      rows: [],
      summary: { attributes: 0, fullyComplete: 0, missingPdtcFields: 0, incompleteTotal: 0, fieldTotals: {} },
    };
  }

  const assetIds = [...new Set(attrRows.map((a) => a.assetId))];
  const assetRows = await db.select().from(assets).where(inArray(assets.id, assetIds));
  const assetMap = new Map<number, Asset>(assetRows.map((a) => [a.id, a]));

  const completionRows = await db.select().from(metadataCompletion);
  const completionMap = new Map<number, MetadataCompletion>(
    completionRows.map((c) => [c.attributeId, c]),
  );

  // One batch query instead of a per-attribute lookup (was an N+1 over ~21k rows):
  // the set of attribute ids that carry an active (non-superseded) classification.
  const classifiedRows = await db
    .select({ id: classifications.targetId })
    .from(classifications)
    .where(and(eq(classifications.scope, "attribute"), isNull(classifications.supersededBy)));
  const classifiedSet = new Set<number>(classifiedRows.map((r) => r.id));

  const rows: CompletionRow[] = [];
  const fieldTotals: Record<string, { present: number; total: number }> = {};
  for (const f of REQUIRED_METADATA) fieldTotals[f.key] = { present: 0, total: 0 };

  let fullyComplete = 0;
  let missingPdtcFields = 0;
  let incompleteTotal = 0;

  for (const attr of attrRows) {
    const asset = assetMap.get(attr.assetId);
    const fields = computeAttributeCompletion(
      attr,
      asset,
      classifiedSet.has(attr.id),
      completionMap.get(attr.id),
    );

    const completeCount = fields.filter((f) => f.present).length;
    if (completeCount === fields.length) fullyComplete++;
    else incompleteTotal++;
    if (fields.some((f) => f.providedBy === "pdtc" && !f.present)) missingPdtcFields++;
    for (const f of fields) {
      fieldTotals[f.key].total++;
      if (f.present) fieldTotals[f.key].present++;
    }

    if (completeCount < fields.length && rows.length < COMPLETION_ROW_CAP) {
      rows.push({
        attributeId: attr.id,
        columnName: attr.columnName,
        assetName: asset?.name ?? "(unknown asset)",
        fields,
        completeCount,
        totalCount: fields.length,
      });
    }
  }

  return {
    rows,
    summary: {
      attributes: attrRows.length,
      fullyComplete,
      missingPdtcFields,
      incompleteTotal,
      fieldTotals,
    },
  };
}
