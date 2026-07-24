/**
 * Canonical IBM Knowledge Catalog (IKC) column names for the two exported sheets
 * PDTC ingests: the ASSET sheet and the ATTRIBUTE sheet. Defined ONCE so the
 * column-mapping UI (client) and the import runner (server) agree on how raw
 * spreadsheet headers map to PDTC's internal fields.
 *
 * `key`      internal PDTC field name (matches shared/models/schema.ts columns)
 * `header`   the canonical IKC column header
 * `aliases`  alternate header spellings the auto-mapper will also accept
 * `required` whether import should refuse to proceed without a mapping
 */

export type IkcSheetType = "asset" | "attribute";

export interface IkcFieldDef {
  key: string;
  header: string;
  aliases: string[];
  required: boolean;
}

export const IKC_ASSET_FIELDS: IkcFieldDef[] = [
  { key: "ikcAssetId", header: "Asset ID", aliases: ["Data Asset ID", "Table ID", "Resource ID"], required: true },
  { key: "name", header: "Asset Name", aliases: ["Name", "Table Name", "Data Asset"], required: true },
  { key: "descriptionEn", header: "Description", aliases: ["Business Description", "Description (EN)"], required: false },
  { key: "descriptionAr", header: "Description (AR)", aliases: ["Arabic Description", "الوصف"], required: false },
  { key: "assetType", header: "Asset Type", aliases: ["Type", "Resource Type"], required: false },
  { key: "businessDomain", header: "Business Domain", aliases: ["Domain"], required: false },
  { key: "subjectArea", header: "Subject Area", aliases: ["Data Domain", "Category"], required: false },
  { key: "department", header: "Department", aliases: ["Owning Department", "Org Unit"], required: false },
  { key: "sector", header: "Sector", aliases: ["Business Sector"], required: false },
  { key: "owner", header: "Owner", aliases: ["Data Owner", "Business Owner"], required: false },
  { key: "stewards", header: "Stewards", aliases: ["Data Steward", "Custodian"], required: false },
  { key: "storage", header: "Storage", aliases: ["Storage Location", "Data Store", "Source System"], required: false },
  { key: "retentionPeriod", header: "Retention Period", aliases: ["Retention", "Retention Policy"], required: false },
  { key: "piiFlag", header: "PII", aliases: ["Contains PII", "PII Flag"], required: false },
  { key: "cdeFlag", header: "CDE", aliases: ["Critical Data Element", "CDE Flag"], required: false },
  { key: "assetClassification", header: "Classification", aliases: ["Asset Classification", "Confidentiality"], required: false },
  { key: "catalogId", header: "Catalog Id", aliases: ["Catalog"], required: false },
  { key: "creatorId", header: "Creator", aliases: ["Created By", "Creator Id"], required: false },
  { key: "tableType", header: "Table Type", aliases: ["Extmeta Table Type"], required: false },
  { key: "tableSchema", header: "Table Schema", aliases: ["Extmeta Table Schema", "Schema"], required: false },
  { key: "connectionId", header: "Connection Id", aliases: ["Connection"], required: false },
  { key: "connectionPath", header: "Connection Path", aliases: ["Path"], required: false },
  { key: "backupFrequency", header: "Backup Frequency", aliases: ["Backup"], required: false },
  { key: "numColumns", header: "Number of Columns", aliases: ["Column Count", "Columns"], required: false },
  { key: "numChildren", header: "Number of Children", aliases: ["Child Count", "Children"], required: false },
  { key: "qualityScore", header: "Quality Score", aliases: ["Data Quality Score"], required: false },
  { key: "analysedRowCount", header: "Analysed Row Count", aliases: ["Row Count", "Analyzed Rows"], required: false },
];

export const IKC_ATTRIBUTE_FIELDS: IkcFieldDef[] = [
  { key: "ikcAssetId", header: "Asset ID", aliases: ["Parent Asset ID", "Table ID", "Data Asset ID"], required: true },
  { key: "assetName", header: "Asset Name", aliases: ["Table Name", "Parent Asset", "Data Asset"], required: false },
  { key: "columnName", header: "Column Name", aliases: ["Column", "Attribute Name", "Field Name", "Name"], required: true },
  { key: "descriptionEn", header: "Description", aliases: ["Column Description", "Business Description", "Description (EN)"], required: false },
  { key: "descriptionAr", header: "Description (AR)", aliases: ["Arabic Description", "الوصف"], required: false },
  { key: "dataType", header: "Data Type", aliases: ["Logical Type", "Type"], required: false },
  { key: "nativeType", header: "Native Type", aliases: ["Physical Type", "Technical Type"], required: false },
  { key: "isPrimaryKey", header: "Primary Key", aliases: ["Is Primary Key", "PK"], required: false },
  { key: "nullable", header: "Nullable", aliases: ["Is Nullable", "Allows Null"], required: false },
  { key: "selectedDataClassName", header: "Data Class", aliases: ["Selected Data Class", "Assigned Data Class"], required: false },
  { key: "selectedDataClassConfidence", header: "Data Class Confidence", aliases: ["Confidence", "Data Class Score"], required: false },
  { key: "suggestedClasses", header: "Suggested Data Classes", aliases: ["Candidate Data Classes", "Suggested Classes"], required: false },
  { key: "columnDataClassification", header: "Column Classification", aliases: ["Data Classification", "Confidentiality"], required: false },
  { key: "piiName", header: "PII", aliases: ["PII Name", "Personal Data", "PII Type"], required: false },
  { key: "piiDescription", header: "PII Description", aliases: ["Personal Data Description"], required: false },
  { key: "cdeFlag", header: "CDE", aliases: ["Critical Data Element", "CDE Flag", "Is CDE"], required: false },
  { key: "length", header: "Length", aliases: ["Column Length", "Size"], required: false },
  { key: "scale", header: "Scale", aliases: ["Numeric Scale"], required: false },
  { key: "signed", header: "Signed", aliases: ["Is Signed"], required: false },
  { key: "qualityScore", header: "Quality Score", aliases: ["Data Quality Score"], required: false },
];

export const IKC_FIELDS: Record<IkcSheetType, IkcFieldDef[]> = {
  asset: IKC_ASSET_FIELDS,
  attribute: IKC_ATTRIBUTE_FIELDS,
};

/** Normalise a header for tolerant matching: lowercase, alphanumerics only. */
export function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "");
}

/**
 * Auto-map a sheet's raw headers onto canonical PDTC field keys. Returns a record
 * of canonicalKey -> matched raw header (or null when nothing matched). The
 * mapping UI seeds its dropdowns from this and lets a steward correct it.
 */
export function autoMapColumns(
  headers: string[],
  sheet: IkcSheetType,
): Record<string, string | null> {
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  const mapping: Record<string, string | null> = {};

  for (const field of IKC_FIELDS[sheet]) {
    const candidates = [field.header, ...field.aliases].map(normalizeHeader);
    const hit = normalized.find((h) => candidates.includes(h.norm));
    mapping[field.key] = hit ? hit.raw : null;
  }
  return mapping;
}

/** Fields the mapper must resolve before an import run may start. */
export function requiredFields(sheet: IkcSheetType): IkcFieldDef[] {
  return IKC_FIELDS[sheet].filter((f) => f.required);
}
