/**
 * Export column catalog (Prompt 2 §8) grouped into categories, plus the row-key
 * used for round-trip matching. The two decision columns are the only editable
 * (unlocked) columns; everything else is read-only and enforced on re-import.
 */
import { createHash } from "node:crypto";
import { CRITERION_CODES } from "@shared/lib/criteria";

export interface ExportColumnDef {
  key: string;
  header: string;
  category: string;
  editable?: boolean;
  rtl?: boolean;
}

// Row identity: sha256 over assetId + columnName (stable across exports).
export function rowKey(assetId: number | string, columnName: string): string {
  return createHash("sha256").update(`${assetId}::${columnName}`).digest("hex");
}

export const EDITABLE_COLUMNS = ["pii_decision", "classification_decision"] as const;

// One Applies + Reasoning (EN AND AR) column per criterion (Prompt 2 §8).
const REASONING_COLUMNS: ExportColumnDef[] = CRITERION_CODES.flatMap((code) => [
  { key: `crit_${code}_applies`, header: `${code} — Applies`, category: "PII Reasoning" },
  { key: `crit_${code}_reason`, header: `${code} — Reasoning (EN)`, category: "PII Reasoning" },
  { key: `crit_${code}_reason_ar`, header: `${code} — Reasoning (AR)`, category: "PII Reasoning", rtl: true },
]);

export const EXPORT_COLUMNS: ExportColumnDef[] = [
  { key: "ikcAssetId", header: "Asset Id", category: "Identity" },
  { key: "assetName", header: "Asset Name", category: "Identity" },
  { key: "columnName", header: "Column Name", category: "Identity" },
  { key: "catalogId", header: "Catalog Id", category: "Identity" },
  // Business Context
  { key: "businessDomain", header: "Business Domain", category: "Business Context" },
  { key: "subjectArea", header: "Subject Area", category: "Business Context" },
  { key: "department", header: "Department", category: "Business Context" },
  { key: "sector", header: "Sector", category: "Business Context" },
  { key: "owner", header: "Owner", category: "Business Context" },
  { key: "stewards", header: "Stewards", category: "Business Context" },
  // Technical
  { key: "dataType", header: "Data Type", category: "Technical" },
  { key: "nativeType", header: "Native Type", category: "Technical" },
  { key: "length", header: "Length", category: "Technical" },
  { key: "scale", header: "Scale", category: "Technical" },
  { key: "nullable", header: "Nullable", category: "Technical" },
  { key: "signed", header: "Signed", category: "Technical" },
  { key: "isPrimaryKey", header: "Is PK", category: "Technical" },
  // Quality
  { key: "qualityScore", header: "Quality Score", category: "Quality" },
  // Data Classes & Terms
  { key: "selectedDataClassName", header: "Selected Class", category: "Data Classes & Terms" },
  { key: "selectedDataClassConfidence", header: "Class Confidence", category: "Data Classes & Terms" },
  { key: "suggestedClasses", header: "Suggested Classes", category: "Data Classes & Terms" },
  // Governance
  { key: "importBatch", header: "Source Import", category: "Governance" },
  { key: "columnDataClassification", header: "Classification", category: "Governance" },
  { key: "retentionPeriod", header: "Retention", category: "Governance" },
  { key: "storage", header: "Storage", category: "Governance" },
  // CDE
  { key: "cdeFlag", header: "CDE", category: "CDE" },
  { key: "cdeDescription", header: "CDE Description", category: "CDE" },
  // PII Findings
  { key: "piiName", header: "PII Name", category: "PII Findings" },
  { key: "piiDescription", header: "PII Description", category: "PII Findings" },
  { key: "verdict", header: "PII Verdict", category: "PII Findings" },
  { key: "criteriaMatched", header: "Criteria Matched", category: "PII Findings" },
  { key: "confidence", header: "Confidence", category: "PII Findings" },
  { key: "sourceLayer", header: "Source Layer", category: "PII Findings" },
  ...REASONING_COLUMNS,
  { key: "overallRationaleEn", header: "Overall Rationale (EN)", category: "PII Reasoning" },
  { key: "overallRationaleAr", header: "Overall Rationale (AR)", category: "PII Reasoning", rtl: true },
  // Classification Findings + Reasoning
  { key: "classLevel", header: "Assigned Level", category: "Classification Findings" },
  { key: "classSource", header: "Classification Source", category: "Classification Findings" },
  { key: "classRationaleEn", header: "Classification Rationale (EN)", category: "Classification Reasoning" },
  { key: "classRationaleAr", header: "Classification Rationale (AR)", category: "Classification Reasoning", rtl: true },
  // Audit
  { key: "runId", header: "Run Id", category: "Audit" },
  { key: "modelId", header: "Model", category: "Audit" },
  { key: "frameworkVersion", header: "Framework Version", category: "Audit" },
  { key: "analysedAt", header: "Analysed At", category: "Audit" },
  // Steward (editable)
  { key: "pii_decision", header: "PII Decision", category: "Steward", editable: true },
  { key: "classification_decision", header: "Classification Decision", category: "Steward", editable: true },
];

export const EXPORT_PRESETS: Record<string, string[]> = {
  "ikc-round-trip": ["ikcAssetId", "assetName", "columnName", "dataType", "nativeType", "selectedDataClassName", "columnDataClassification"],
  // Source Import included so a reviewer can tell which catalog load a row came
  // from — the two IKC loads share table-name prefixes and even table names.
  "steward-review": ["ikcAssetId", "assetName", "columnName", "importBatch", "verdict", "criteriaMatched", "piiName", "confidence", "pii_decision", "classification_decision"],
  "full-export": EXPORT_COLUMNS.map((c) => c.key),
};

export function columnByKey(key: string): ExportColumnDef | undefined {
  return EXPORT_COLUMNS.find((c) => c.key === key);
}
