/**
 * Filter definitions declared as DATA (Prompt 2 §2). Both the client filter panel
 * and the server predicate builder are driven from these. Keys map either to real
 * catalog columns (predicate in server/catalog/query.ts) or to derived predicates
 * (EXISTS subqueries on detections / review_items / classifications).
 */

export type CatalogScreen = "assets" | "attributes";

export type FilterGroup =
  | "identity"
  | "business"
  | "technical"
  | "quality"
  | "governance"
  | "pii"
  | "classification"
  | "analysis"
  | "review"
  | "completeness";

export type FilterControl =
  | "text"
  | "multiselect"
  | "boolean"
  | "tristate"
  | "numeric-range"
  | "date-range"
  | "enum"
  | "exists";

export interface FilterOption {
  value: string;
  labelEn: string;
  labelAr: string;
}

export interface FilterDefinition {
  key: string;
  labelEn: string;
  labelAr: string;
  group: FilterGroup;
  control: FilterControl;
  optionsSource?: "static" | "distinct";
  staticOptions?: FilterOption[];
  min?: number;
  max?: number;
  /**
   * Hidden until the user opens "More filters". The default set is the handful a
   * steward actually reaches for; everything else is specialist and was turning
   * the panel into a wall of ~46 controls.
   */
  advanced?: boolean;
  /**
   * Availability key — when set, the panel hides this filter unless the catalog
   * has something to filter ON (see /api/catalog/filter-availability). Governance
   * and review filters are real features that are simply switched off in a given
   * deployment; they should appear the day data exists, not before.
   */
  availability?: string;
}

export const FILTER_GROUP_LABELS: Record<FilterGroup, { en: string; ar: string }> = {
  identity: { en: "Identity & Search", ar: "الهوية والبحث" },
  business: { en: "Business Context", ar: "السياق التجاري" },
  technical: { en: "Technical / Structure", ar: "تقني / بنيوي" },
  quality: { en: "Quality", ar: "الجودة" },
  governance: { en: "Governance", ar: "الحوكمة" },
  pii: { en: "PII Findings", ar: "نتائج البيانات الشخصية" },
  classification: { en: "Classification", ar: "التصنيف" },
  analysis: { en: "Analysis State", ar: "حالة التحليل" },
  review: { en: "Review State", ar: "حالة المراجعة" },
  completeness: { en: "Completeness", ar: "الاكتمال" },
};

const opt = (value: string, en: string, ar: string): FilterOption => ({ value, labelEn: en, labelAr: ar });

const VERDICT_OPTIONS = [
  opt("pii", "PII", "بيانات شخصية"),
  opt("not_pii", "Not PII", "غير شخصية"),
  opt("uncertain", "Uncertain", "غير مؤكد"),
  opt("not_analysed", "Not analysed", "لم تُحلّل"),
];

const CLASSIFICATION_OPTIONS = [
  opt("OPEN", "Open", "مفتوح"),
  opt("CONFIDENTIAL", "Confidential", "سري"),
  opt("SENSITIVE", "Sensitive", "حساس"),
  opt("SECRET", "Secret", "سري للغاية"),
  opt("UNCLASSIFIED", "Unclassified", "غير مصنّف"),
];

const CRITERION_OPTIONS = [
  opt("DIRECT_ID", "Direct Identifiability", "التعريف المباشر"),
  opt("INDIRECT_ID", "Indirect Identifiability", "التعريف غير المباشر"),
  opt("REGULATORY", "Regulatory Sensitivity", "الحساسية التنظيمية"),
  opt("CONTEXTUAL", "Contextual Risk", "المخاطر السياقية"),
  opt("SPECIAL_CATEGORY", "Special Categories", "الفئات الخاصة"),
];

const SOURCE_LAYER_OPTIONS = [
  opt("ikc_class", "IKC class", "فئة IKC"),
  opt("adc_class", "ADC class library", "مكتبة فئات ADC"),
  opt("llm", "LLM", "النموذج اللغوي"),
];

const CLASSIFICATION_SOURCE_OPTIONS = [
  opt("engine", "Engine", "المحرك"),
  opt("rollup", "Rollup", "التجميع"),
  opt("override", "Steward override", "تجاوز أمين البيانات"),
  opt("none", "Not classified", "غير مصنّف"),
];

const REVIEW_STATUS_OPTIONS = [
  opt("not_queued", "Not queued", "غير مدرج"),
  opt("pending", "Pending", "معلّق"),
  opt("accepted", "Accepted", "مقبول"),
  opt("rejected", "Rejected", "مرفوض"),
  opt("overridden", "Overridden", "متجاوَز"),
];

export const ASSET_FILTERS: FilterDefinition[] = [
  { key: "search", labelEn: "Search", labelAr: "بحث", group: "identity", control: "text" },
  { key: "ikcAssetId", labelEn: "Asset Id", labelAr: "معرّف الأصل", group: "identity", control: "text" },
  { key: "name", labelEn: "Name", labelAr: "الاسم", group: "identity", control: "text" },
  { key: "assetType", labelEn: "Asset Type", labelAr: "نوع الأصل", group: "identity", control: "multiselect", optionsSource: "distinct" },
  { key: "importBatch", labelEn: "Import", labelAr: "الاستيراد", group: "identity", control: "multiselect", optionsSource: "distinct" },
  { key: "catalogId", labelEn: "Catalog Id", labelAr: "معرّف الكتالوج", group: "identity", control: "multiselect", optionsSource: "distinct" },

  { key: "businessDomain", labelEn: "Business Domain", labelAr: "المجال التجاري", group: "business", control: "multiselect", optionsSource: "distinct" },
  { key: "subjectArea", labelEn: "Subject Area", labelAr: "مجال الموضوع", group: "business", control: "multiselect", optionsSource: "distinct" },
  { key: "department", labelEn: "Department", labelAr: "الإدارة", group: "business", control: "multiselect", optionsSource: "distinct" },
  { key: "sector", labelEn: "Sector", labelAr: "القطاع", group: "business", control: "multiselect", optionsSource: "distinct" },
  { key: "ownerId", labelEn: "Owner", labelAr: "المالك", group: "business", control: "multiselect", optionsSource: "distinct" },
  { key: "stewards", labelEn: "Data Stewards", labelAr: "أمناء البيانات", group: "business", control: "multiselect", optionsSource: "distinct" },
  { key: "creatorId", labelEn: "Creator", labelAr: "المُنشئ", group: "business", control: "multiselect", optionsSource: "distinct" },

  { key: "tableType", labelEn: "Table Type", labelAr: "نوع الجدول", group: "technical", control: "multiselect", optionsSource: "distinct" },
  { key: "tableSchema", labelEn: "Table Schema", labelAr: "مخطط الجدول", group: "technical", control: "multiselect", optionsSource: "distinct" },
  { key: "storage", labelEn: "Storage", labelAr: "التخزين", group: "technical", control: "multiselect", optionsSource: "distinct" },
  { key: "connectionId", labelEn: "Connection Id", labelAr: "معرّف الاتصال", group: "technical", control: "multiselect", optionsSource: "distinct" },
  { key: "numColumns", labelEn: "Number of columns", labelAr: "عدد الأعمدة", group: "technical", control: "numeric-range", min: 0 },
  { key: "numChildren", labelEn: "Number of children", labelAr: "عدد التوابع", group: "technical", control: "numeric-range", min: 0 },

  { key: "qualityScore", labelEn: "Quality score", labelAr: "درجة الجودة", group: "quality", control: "numeric-range", min: 0, max: 100 },
  { key: "analysedRowCount", labelEn: "Analysed row count", labelAr: "عدد الصفوف المحلّلة", group: "quality", control: "numeric-range", min: 0 },

  { key: "assetClassification", labelEn: "Asset Classification", labelAr: "تصنيف الأصل", group: "governance", control: "multiselect", optionsSource: "static", staticOptions: CLASSIFICATION_OPTIONS },
  { key: "classificationSource", labelEn: "Classification source", labelAr: "مصدر التصنيف", group: "governance", control: "enum", optionsSource: "static", staticOptions: CLASSIFICATION_SOURCE_OPTIONS },
  { key: "piiFlag", labelEn: "PII flag", labelAr: "علامة البيانات الشخصية", group: "governance", control: "tristate" },
  { key: "cdeFlag", labelEn: "Critical Data Element", labelAr: "عنصر بيانات حرج", group: "governance", control: "tristate" },
  { key: "retentionPeriod", labelEn: "Retention Period", labelAr: "مدة الاحتفاظ", group: "governance", control: "multiselect", optionsSource: "distinct" },
  { key: "backupFrequency", labelEn: "Backup Frequency", labelAr: "تكرار النسخ الاحتياطي", group: "governance", control: "multiselect", optionsSource: "distinct" },

  { key: "containsConflicts", labelEn: "Contains layer conflicts", labelAr: "يحتوي على تعارضات", group: "analysis", control: "boolean" },
  { key: "containsUncertain", labelEn: "Contains uncertain verdicts", labelAr: "يحتوي على قرارات غير مؤكدة", group: "analysis", control: "boolean" },

  { key: "hasEnDescription", labelEn: "English description present", labelAr: "وصف إنجليزي موجود", group: "completeness", control: "exists" },
  { key: "hasArDescription", labelEn: "Arabic description present", labelAr: "وصف عربي موجود", group: "completeness", control: "exists" },
  { key: "hasOwner", labelEn: "Owner assigned", labelAr: "مالك معيّن", group: "completeness", control: "exists" },
  { key: "hasStewards", labelEn: "Steward assigned", labelAr: "أمين معيّن", group: "completeness", control: "exists" },
  { key: "hasBusinessDomain", labelEn: "Business domain assigned", labelAr: "مجال معيّن", group: "completeness", control: "exists" },
];

/**
 * Attribute filters, ordered default-set first.
 *
 * Ten filters were removed outright because they cannot match anything by
 * construction, not merely because a given catalog is empty:
 *   criteriaCount   — the engine records ONE criterion per detection, so the
 *                     count can never reach 2 and the range is meaningless.
 *   conflict        — needs two layers to disagree; in practice only the LLM
 *                     layer produces a signal, so nothing ever conflicts.
 *   cooccurrence    — the co-occurrence engine writes no findings.
 *   assetType       — one value across the whole catalog (nothing to narrow).
 *   storage         — likewise one value.
 *   piiName         — populated only by formal approval; effectively always null.
 *   hasBusinessTerms / hasSuggestedTerms — the IKC export carries neither.
 *   classificationSource — no attribute-scope classification rows are written.
 */
export const ATTRIBUTE_FILTERS: FilterDefinition[] = [
  // --- default set: what a steward actually reaches for -------------------
  { key: "search", labelEn: "Search", labelAr: "بحث", group: "identity", control: "text" },
  { key: "columnName", labelEn: "Column Name", labelAr: "اسم العمود", group: "identity", control: "text" },
  { key: "assetId", labelEn: "Asset", labelAr: "الأصل", group: "identity", control: "multiselect", optionsSource: "distinct" },
  // Which IKC import the column came from. The only reliable old-catalog /
  // new-catalog split: both share table-name prefixes and some table names.
  { key: "importBatch", labelEn: "Import", labelAr: "الاستيراد", group: "identity", control: "multiselect", optionsSource: "distinct" },
  { key: "businessDomain", labelEn: "Business Domain", labelAr: "المجال التجاري", group: "business", control: "multiselect", optionsSource: "distinct" },
  { key: "verdict", labelEn: "PII verdict", labelAr: "قرار البيانات الشخصية", group: "pii", control: "multiselect", optionsSource: "static", staticOptions: VERDICT_OPTIONS },
  { key: "criterion", labelEn: "Matched criterion", labelAr: "المعيار المطابق", group: "pii", control: "multiselect", optionsSource: "static", staticOptions: CRITERION_OPTIONS },
  { key: "engineConfidence", labelEn: "Engine confidence", labelAr: "ثقة المحرك", group: "pii", control: "numeric-range", min: 0, max: 1 },
  { key: "columnDataClassification", labelEn: "Column classification", labelAr: "تصنيف العمود", group: "classification", control: "multiselect", optionsSource: "static", staticOptions: CLASSIFICATION_OPTIONS },
  { key: "cdeFlag", labelEn: "Critical Data Element", labelAr: "عنصر بيانات حرج", group: "governance", control: "tristate" },
  { key: "dataType", labelEn: "Data type", labelAr: "نوع البيانات", group: "technical", control: "multiselect", optionsSource: "distinct" },
  { key: "lastAnalysed", labelEn: "Last analysed", labelAr: "آخر تحليل", group: "review", control: "date-range" },
  { key: "hasEnDescription", labelEn: "English description present", labelAr: "وصف إنجليزي موجود", group: "completeness", control: "exists" },

  // --- advanced: works, has data, but specialist --------------------------
  { key: "subjectArea", labelEn: "Subject Area", labelAr: "مجال الموضوع", group: "business", control: "multiselect", optionsSource: "distinct", advanced: true },
  { key: "department", labelEn: "Department", labelAr: "الإدارة", group: "business", control: "multiselect", optionsSource: "distinct", advanced: true },
  { key: "sector", labelEn: "Sector", labelAr: "القطاع", group: "business", control: "multiselect", optionsSource: "distinct", advanced: true },
  { key: "parentClassification", labelEn: "Parent asset classification", labelAr: "تصنيف الأصل الأصل", group: "business", control: "multiselect", optionsSource: "static", staticOptions: CLASSIFICATION_OPTIONS, advanced: true },
  { key: "parentIsCde", labelEn: "Parent asset is CDE", labelAr: "الأصل الأصل حرج", group: "business", control: "tristate", advanced: true },

  { key: "nativeType", labelEn: "Native type", labelAr: "النوع الأصلي", group: "technical", control: "multiselect", optionsSource: "distinct", advanced: true },
  { key: "length", labelEn: "Length", labelAr: "الطول", group: "technical", control: "numeric-range", min: 0, advanced: true },
  { key: "scale", labelEn: "Scale", labelAr: "المقياس", group: "technical", control: "numeric-range", min: 0, advanced: true },
  { key: "nullable", labelEn: "Nullable", labelAr: "يقبل القيمة الفارغة", group: "technical", control: "tristate", advanced: true },
  { key: "signed", labelEn: "Signed", labelAr: "موقّع", group: "technical", control: "tristate", advanced: true },
  { key: "isPrimaryKey", labelEn: "Is primary key", labelAr: "مفتاح رئيسي", group: "technical", control: "tristate", advanced: true },

  { key: "qualityScore", labelEn: "Quality score", labelAr: "درجة الجودة", group: "quality", control: "numeric-range", min: 0, max: 100, advanced: true },

  { key: "selectedDataClassName", labelEn: "Selected data class", labelAr: "فئة البيانات المختارة", group: "classification", control: "multiselect", optionsSource: "distinct", advanced: true },
  { key: "selectedDataClassConfidence", labelEn: "Selected class confidence", labelAr: "ثقة الفئة المختارة", group: "classification", control: "numeric-range", min: 0, max: 1, advanced: true },
  { key: "hasSuggestedClasses", labelEn: "Has suggested classes", labelAr: "لديه فئات مقترحة", group: "classification", control: "boolean", advanced: true },

  { key: "sourceLayer", labelEn: "Detection source layer", labelAr: "طبقة مصدر الكشف", group: "pii", control: "multiselect", optionsSource: "static", staticOptions: SOURCE_LAYER_OPTIONS, advanced: true },
  // Kept (not deleted) because the Special KPI card applies it: it appears once a
  // run actually scores SPECIAL_CATEGORY, which the Direct+Indirect scope does not.
  { key: "specialCategory", labelEn: "Special category", labelAr: "فئة خاصة", group: "pii", control: "boolean", advanced: true, availability: "specialCategory" },
  { key: "engineRun", labelEn: "Engine run", labelAr: "تشغيل المحرك", group: "review", control: "multiselect", optionsSource: "distinct", advanced: true },
  { key: "hasArDescription", labelEn: "Arabic description present", labelAr: "وصف عربي موجود", group: "completeness", control: "exists", advanced: true },

  // --- availability-gated: real features, hidden until switched on --------
  { key: "reviewStatus", labelEn: "Review status", labelAr: "حالة المراجعة", group: "review", control: "enum", optionsSource: "static", staticOptions: REVIEW_STATUS_OPTIONS, advanced: true, availability: "reviewItems" },
  { key: "assignedTo", labelEn: "Assigned to", labelAr: "مُسند إلى", group: "review", control: "multiselect", optionsSource: "distinct", advanced: true, availability: "reviewAssignees" },
  { key: "resolvedBy", labelEn: "Resolved by", labelAr: "حُسم بواسطة", group: "review", control: "multiselect", optionsSource: "distinct", advanced: true, availability: "reviewResolvers" },
  { key: "consentStatus", labelEn: "Consent status", labelAr: "حالة الموافقة", group: "governance", control: "multiselect", optionsSource: "distinct", advanced: true, availability: "consentStatus" },
  { key: "accessControlLevel", labelEn: "Access control level", labelAr: "مستوى التحكم في الوصول", group: "governance", control: "multiselect", optionsSource: "distinct", advanced: true, availability: "accessControlLevel" },
  { key: "processingPurposePresent", labelEn: "Processing purpose present", labelAr: "غرض المعالجة موجود", group: "governance", control: "exists", advanced: true, availability: "processingPurpose" },
];

export const FILTERS_BY_SCREEN: Record<CatalogScreen, FilterDefinition[]> = {
  assets: ASSET_FILTERS,
  attributes: ATTRIBUTE_FILTERS,
};

export type FilterState = Record<string, unknown>;
