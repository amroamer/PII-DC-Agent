/**
 * Single source of truth for the PDTC database. Every pgTable lives here.
 *
 * Conventions:
 *  - camelCase TS fields auto-map to snake_case SQL columns (drizzle `casing`
 *    option in server/db.ts + drizzle.config.ts). Do NOT hand-write column names.
 *  - Constrained string columns carry a `$type<Union>()` so the compiler enforces
 *    the allowed values without needing a Postgres enum + migration churn.
 *  - Criterion / classification / IKC codes are typed from shared/lib — never
 *    re-declared as string literals here.
 */
import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  real,
  uniqueIndex,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import type { CriterionCode, EvaluationMode } from "../lib/criteria";
import { CLASSIFICATION_CODES, type ClassificationCode } from "../lib/classification";
import type { IkcSheetType } from "../lib/ikc-fields";

// ---------------------------------------------------------------------------
// Domain unions (kept here because they describe row shapes, not policy config)
// ---------------------------------------------------------------------------
export type UserRole = "admin" | "steward" | "viewer";
export type IngestStatus = "pending" | "mapping" | "importing" | "completed" | "failed";
export type DetectionLayer = "ikc_class" | "adc_class" | "llm";
export type DetectionVerdict = "pii" | "not_pii" | "uncertain";
export type DataClassSource = "ikc" | "adc";
export type ClassificationScope = "attribute" | "asset";
export type DerivedFrom = "engine" | "rollup" | "override";
export type ReviewTargetType = "detection" | "attribute" | "asset";
export type ReviewStatus = "pending" | "accepted" | "rejected" | "overridden";
export type WritebackStatus = "draft" | "queued" | "dispatched" | "failed";

// --- Prompt 2 unions -------------------------------------------------------
export type EngineType = "pii" | "classification";
export type EngineRunStatus = "running" | "completed" | "approved" | "discarded" | "failed" | "cancelled";
export type CatalogTargetType = "attribute" | "asset";
export type StewardDecision = "accept" | "reject" | "override" | "pending";
export type FrameworkType = "pii" | "classification";
export type ImportStatusV2 = "validating" | "ready" | "approved" | "discarded" | "failed";
export type ImportMatchMode = "batch" | "keys";
export type ImportChangeType =
  | "pii_verdict"
  | "classification"
  | "reasoning"
  | "cde"
  | "cleared"
  | "other";
export type ImportDiffStatus = "pending" | "accepted" | "rejected" | "applied";
export type AuditSource = "engine" | "steward" | "import" | "system";

// ===========================================================================
// Reference / seeded tables
// ===========================================================================
export const users = pgTable("users", {
  id: serial().primaryKey(),
  username: text().notNull().unique(),
  passwordHash: text().notNull(),
  role: text().$type<UserRole>().notNull().default("steward"),
  createdAt: timestamp().notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
});

export const systemPrompts = pgTable("system_prompts", {
  key: text().primaryKey(),
  label: text().notNull(),
  content: text().notNull(),
  updatedAt: timestamp().notNull().defaultNow(),
});

export const policyCriteria = pgTable("policy_criteria", {
  code: text().$type<CriterionCode>().primaryKey(),
  nameEn: text().notNull(),
  nameAr: text().notNull(),
  description: text().notNull(),
  evaluationMode: text().$type<EvaluationMode>().notNull(),
});

export const classificationLevels = pgTable("classification_levels", {
  code: text().$type<ClassificationCode>().primaryKey(),
  label: text().notNull(),
  rank: integer().notNull(),
  colorToken: text().notNull(),
});

export const dataClasses = pgTable(
  "data_classes",
  {
    code: text().primaryKey(),
    nameEn: text().notNull(),
    nameAr: text().notNull(),
    category: text().notNull(),
    isPii: boolean().notNull().default(false),
    isSpecialCategory: boolean().notNull().default(false),
    detectionHints: jsonb().$type<string[]>().notNull().default([]),
    source: text().$type<DataClassSource>().notNull(),
    active: boolean().notNull().default(true),
  },
  (t) => [index("data_classes_source_idx").on(t.source)],
);

// ===========================================================================
// Ingested metadata (mirrors the two IKC sheets; stores a subset + rawRow)
// ===========================================================================
export const ingestRuns = pgTable("ingest_runs", {
  id: serial().primaryKey(),
  filename: text().notNull(),
  sheetType: text().$type<IkcSheetType>().notNull(),
  rowCount: integer().notNull().default(0),
  status: text().$type<IngestStatus>().notNull().default("pending"),
  startedAt: timestamp().notNull().defaultNow(),
  finishedAt: timestamp(),
});

export const assets = pgTable(
  "assets",
  {
    id: serial().primaryKey(),
    ikcAssetId: text().notNull(),
    name: text().notNull(),
    descriptionEn: text(),
    descriptionAr: text(),
    assetType: text(),
    // Multi-value facets — IKC exports these as list literals; parsed to arrays at import.
    businessDomain: jsonb().$type<string[]>(),
    subjectArea: jsonb().$type<string[]>(),
    department: jsonb().$type<string[]>(),
    sector: jsonb().$type<string[]>(),
    ownerId: text(),
    stewards: jsonb().$type<string[]>(),
    storage: text(),
    retentionPeriod: text(),
    piiFlag: boolean().notNull().default(false),
    cdeFlag: boolean().notNull().default(false),
    assetClassification: text().$type<ClassificationCode | null>(),
    // Prompt 2 §2.1 — extra IKC-sourced structural/quality/governance metadata.
    catalogId: text(),
    creatorId: text(),
    tableType: text(),
    tableSchema: text(),
    connectionId: text(),
    connectionPath: text(),
    backupFrequency: text(),
    numColumns: integer(),
    numChildren: integer(),
    qualityScore: real(),
    analysedRowCount: integer(),
    tags: jsonb().$type<string[]>(),
    rawRow: jsonb().$type<Record<string, unknown>>(),
    ingestRunId: integer().references(() => ingestRuns.id),
  },
  (t) => [uniqueIndex("assets_ikc_asset_id_idx").on(t.ikcAssetId)],
);

export const attributes = pgTable(
  "attributes",
  {
    id: serial().primaryKey(),
    assetId: integer()
      .notNull()
      .references(() => assets.id),
    columnName: text().notNull(),
    descriptionEn: text(),
    descriptionAr: text(),
    dataType: text(),
    nativeType: text(),
    isPrimaryKey: boolean().notNull().default(false),
    nullable: boolean().notNull().default(true),
    selectedDataClassName: text(),
    selectedDataClassConfidence: real(),
    suggestedClasses: jsonb().$type<string[]>(),
    columnDataClassification: text().$type<ClassificationCode | null>(),
    piiName: text(),
    piiDescription: text(),
    cdeFlag: boolean().notNull().default(false),
    // Prompt 2 §2.2 — extra IKC-sourced technical/quality/term metadata.
    length: integer(),
    scale: integer(),
    signed: boolean(),
    qualityScore: real(),
    businessTerms: jsonb().$type<string[]>(),
    suggestedTerms: jsonb().$type<string[]>(),
    rawRow: jsonb().$type<Record<string, unknown>>(),
    ingestRunId: integer().references(() => ingestRuns.id),
  },
  (t) => [index("attributes_asset_id_idx").on(t.assetId)],
);

// ===========================================================================
// Engine output
// ===========================================================================
export const detections = pgTable(
  "detections",
  {
    id: serial().primaryKey(),
    attributeId: integer()
      .notNull()
      .references(() => attributes.id),
    layer: text().$type<DetectionLayer>().notNull(),
    criterionCode: text().$type<CriterionCode | null>(),
    verdict: text().$type<DetectionVerdict>().notNull(),
    dataClassCode: text(),
    // 0..1 confidence. Stored as real for JS-number ergonomics.
    confidence: real().notNull().default(0),
    rationaleEn: text(),
    rationaleAr: text(),
    evidence: jsonb().$type<Record<string, unknown>>(),
    engineVersion: text().notNull(),
    runId: text().notNull(),
    // Provenance (Prompt 2 §7.5) — every finding traces to the exact inputs.
    modelId: text(),
    promptVersion: text(),
    frameworkVersion: text(),
    inputHash: text(),
    cached: boolean().notNull().default(false),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    index("detections_attribute_id_idx").on(t.attributeId),
    index("detections_run_id_idx").on(t.runId),
  ],
);

export const cooccurrenceFindings = pgTable("cooccurrence_findings", {
  id: serial().primaryKey(),
  assetId: integer()
    .notNull()
    .references(() => assets.id),
  attributeIds: jsonb().$type<number[]>().notNull(),
  combinationLabel: text().notNull(),
  riskScore: real().notNull().default(0),
  rationale: text(),
  runId: text().notNull(),
});

export const classifications = pgTable(
  "classifications",
  {
    id: serial().primaryKey(),
    scope: text().$type<ClassificationScope>().notNull(),
    targetId: integer().notNull(),
    levelCode: text().$type<ClassificationCode>().notNull(),
    derivedFrom: text().$type<DerivedFrom>().notNull(),
    rationale: text(),
    supersededBy: integer(),
    // Provenance (Prompt 2 §7.5). Null for pure rollup/override rows.
    modelId: text(),
    promptVersion: text(),
    frameworkVersion: text(),
    engineVersion: text(),
    inputHash: text(),
    cached: boolean().notNull().default(false),
    runId: text(),
    overriddenByImport: integer(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [index("classifications_scope_target_idx").on(t.scope, t.targetId)],
);

export const reviewItems = pgTable(
  "review_items",
  {
    id: serial().primaryKey(),
    targetType: text().$type<ReviewTargetType>().notNull(),
    targetId: integer().notNull(),
    detectionId: integer().references(() => detections.id),
    status: text().$type<ReviewStatus>().notNull().default("pending"),
    priority: integer().notNull().default(0),
    assignedTo: integer().references(() => users.id),
    resolvedBy: integer().references(() => users.id),
    resolvedAt: timestamp(),
    decisionRationale: text(),
  },
  (t) => [index("review_items_status_idx").on(t.status)],
);

export const metadataCompletion = pgTable("metadata_completion", {
  id: serial().primaryKey(),
  attributeId: integer()
    .notNull()
    .references(() => attributes.id),
  // The two policy-mandated fields IKC has no native home for:
  processingPurpose: text(),
  consentStatus: text(),
  accessControlLevel: text(),
  updatedBy: integer().references(() => users.id),
  updatedAt: timestamp().notNull().defaultNow(),
});

// Append-only. There is no UPDATE or DELETE path against this table anywhere.
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial().primaryKey(),
    actorId: integer().references(() => users.id),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    before: jsonb(),
    after: jsonb(),
    rationale: text(),
    // Prompt 2: provenance of the change.
    source: text().$type<AuditSource>().notNull().default("system"),
    runId: integer(),
    importBatchId: integer(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entityType, t.entityId)],
);

export const writebackBatches = pgTable("writeback_batches", {
  id: serial().primaryKey(),
  status: text().$type<WritebackStatus>().notNull().default("draft"),
  payload: jsonb().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
  dispatchedAt: timestamp(),
});

// ===========================================================================
// Prompt 2 — frameworks, staged engine runs, catalog views, export/import
// ===========================================================================

export const frameworks = pgTable("frameworks", {
  id: serial().primaryKey(),
  type: text().$type<FrameworkType>().notNull().unique(),
  activeVersionId: integer(),
});

export const frameworkVersions = pgTable(
  "framework_versions",
  {
    id: serial().primaryKey(),
    frameworkId: integer()
      .notNull()
      .references(() => frameworks.id),
    version: text().notNull(),
    definition: jsonb().$type<Record<string, unknown>>().notNull(),
    authorId: integer().references(() => users.id),
    changeNote: text(),
    immutable: boolean().notNull().default(true),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [index("framework_versions_framework_idx").on(t.frameworkId)],
);

// A staged engine run. Writes ONLY to run_items/criterion_assessments until an
// explicit approval transaction commits to the catalog (Prompt 2 §0, §6.3).
export const engineRuns = pgTable("engine_runs", {
  id: serial().primaryKey(),
  engineType: text().$type<EngineType>().notNull(),
  scopeSelection: jsonb().$type<Record<string, unknown>>().notNull(),
  params: jsonb().$type<Record<string, unknown>>().notNull(),
  status: text().$type<EngineRunStatus>().notNull().default("running"),
  initiatedBy: integer().references(() => users.id),
  // Force-fresh runs link to the prior run for side-by-side comparison (§7.3).
  previousRunId: integer(),
  runNote: text(),
  justification: text(),
  modelId: text(),
  promptVersion: text(),
  frameworkVersionId: integer().references(() => frameworkVersions.id),
  engineVersion: text(),
  temperature: real().notNull().default(0),
  seed: integer(),
  totalItems: integer().notNull().default(0),
  processedItems: integer().notNull().default(0),
  cachedItems: integer().notNull().default(0),
  errorItems: integer().notNull().default(0),
  startedAt: timestamp().notNull().defaultNow(),
  completedAt: timestamp(),
  approvedBy: integer().references(() => users.id),
  approvedAt: timestamp(),
});

export const runItems = pgTable(
  "run_items",
  {
    id: serial().primaryKey(),
    runId: integer()
      .notNull()
      .references(() => engineRuns.id),
    targetType: text().$type<CatalogTargetType>().notNull(),
    targetId: integer().notNull(),
    verdict: text().$type<DetectionVerdict | null>(),
    suggestedClassCode: text(),
    suggestedLevelCode: text().$type<ClassificationCode | null>(),
    confidence: real().notNull().default(0),
    rationaleEn: text(),
    rationaleAr: text(),
    sourceLayers: jsonb().$type<string[]>(),
    conflict: boolean().notNull().default(false),
    currentValue: jsonb().$type<Record<string, unknown>>(),
    stewardDecision: text().$type<StewardDecision>().notNull().default("pending"),
    overrideValue: jsonb().$type<Record<string, unknown>>(),
    overrideRationale: text(),
    inputHash: text(),
    cached: boolean().notNull().default(false),
  },
  (t) => [index("run_items_run_idx").on(t.runId)],
);

export const criterionAssessments = pgTable(
  "criterion_assessments",
  {
    id: serial().primaryKey(),
    runItemId: integer()
      .notNull()
      .references(() => runItems.id),
    criterionCode: text().$type<CriterionCode>().notNull(),
    applies: boolean().notNull().default(false),
    rationaleEn: text(),
    rationaleAr: text(),
    confidence: real().notNull().default(0),
    signals: jsonb().$type<string[]>(),
  },
  (t) => [index("criterion_assessments_run_item_idx").on(t.runItemId)],
);

export const llmCache = pgTable("llm_cache", {
  inputHash: text().primaryKey(),
  response: jsonb().$type<Record<string, unknown>>().notNull(),
  modelId: text().notNull(),
  promptVersion: text().notNull(),
  frameworkVersionId: integer(),
  engineVersion: text().notNull(),
  schemaVersion: text().notNull(),
  tokensUsed: integer().notNull().default(0),
  hitCount: integer().notNull().default(0),
  createdAt: timestamp().notNull().defaultNow(),
  lastHitAt: timestamp(),
});

export const savedViews = pgTable("saved_views", {
  id: serial().primaryKey(),
  userId: integer().references(() => users.id),
  screen: text().notNull(),
  name: text().notNull(),
  filters: jsonb().$type<Record<string, unknown>>().notNull(),
  columns: jsonb().$type<string[]>(),
  shared: boolean().notNull().default(false),
});

export const exportBatches = pgTable("export_batches", {
  id: serial().primaryKey(),
  scope: jsonb().$type<Record<string, unknown>>().notNull(),
  filters: jsonb().$type<Record<string, unknown>>(),
  columns: jsonb().$type<string[]>().notNull(),
  rowKeys: jsonb().$type<string[]>(),
  filename: text().notNull(),
  rowCount: integer().notNull().default(0),
  createdBy: integer().references(() => users.id),
  createdAt: timestamp().notNull().defaultNow(),
});

export const importBatches = pgTable("import_batches", {
  id: serial().primaryKey(),
  exportBatchId: integer().references(() => exportBatches.id),
  filename: text().notNull(),
  status: text().$type<ImportStatusV2>().notNull().default("validating"),
  matchMode: text().$type<ImportMatchMode>().notNull().default("batch"),
  summary: jsonb().$type<Record<string, unknown>>(),
  justification: text(),
  createdBy: integer().references(() => users.id),
  createdAt: timestamp().notNull().defaultNow(),
  approvedBy: integer().references(() => users.id),
  approvedAt: timestamp(),
});

export const importDiffs = pgTable(
  "import_diffs",
  {
    id: serial().primaryKey(),
    importBatchId: integer()
      .notNull()
      .references(() => importBatches.id),
    targetType: text().$type<CatalogTargetType>().notNull(),
    targetId: integer().notNull(),
    field: text().notNull(),
    currentValue: text(),
    incomingValue: text(),
    changeType: text().$type<ImportChangeType>().notNull(),
    status: text().$type<ImportDiffStatus>().notNull().default("pending"),
    appliedAt: timestamp(),
  },
  (t) => [index("import_diffs_batch_idx").on(t.importBatchId)],
);

// Raw binary column for file bytes (persisted in Postgres so files survive redeploys).
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const storedFiles = pgTable(
  "stored_files",
  {
    id: serial().primaryKey(),
    filename: text().notNull(),
    mimeType: text(),
    size: integer().notNull().default(0),
    content: bytea().notNull(),
    uploadedBy: integer().references(() => users.id),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [index("stored_files_filename_idx").on(t.filename)],
);

// ===========================================================================
// Inferred row types
// ===========================================================================
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
export type Attribute = typeof attributes.$inferSelect;
export type NewAttribute = typeof attributes.$inferInsert;
export type IngestRun = typeof ingestRuns.$inferSelect;
export type Detection = typeof detections.$inferSelect;
export type NewDetection = typeof detections.$inferInsert;
export type CooccurrenceFinding = typeof cooccurrenceFindings.$inferSelect;
export type Classification = typeof classifications.$inferSelect;
export type NewClassification = typeof classifications.$inferInsert;
export type ReviewItem = typeof reviewItems.$inferSelect;
export type MetadataCompletion = typeof metadataCompletion.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type WritebackBatch = typeof writebackBatches.$inferSelect;
export type DataClass = typeof dataClasses.$inferSelect;
export type SystemPrompt = typeof systemPrompts.$inferSelect;

export type Framework = typeof frameworks.$inferSelect;
export type FrameworkVersion = typeof frameworkVersions.$inferSelect;
export type EngineRun = typeof engineRuns.$inferSelect;
export type NewEngineRun = typeof engineRuns.$inferInsert;
export type RunItem = typeof runItems.$inferSelect;
export type NewRunItem = typeof runItems.$inferInsert;
export type CriterionAssessment = typeof criterionAssessments.$inferSelect;
export type NewCriterionAssessment = typeof criterionAssessments.$inferInsert;
export type LlmCacheRow = typeof llmCache.$inferSelect;
export type SavedView = typeof savedViews.$inferSelect;
export type ExportBatch = typeof exportBatches.$inferSelect;
export type ImportBatch = typeof importBatches.$inferSelect;
export type ImportDiff = typeof importDiffs.$inferSelect;
export type StoredFile = typeof storedFiles.$inferSelect;

// ===========================================================================
// Zod input validation (drizzle-zod + hardened, policy-critical schemas)
// ===========================================================================
export const insertUserSchema = createInsertSchema(users, {
  username: (s) => s.min(3),
}).pick({ username: true, role: true });

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** A non-empty rationale is REQUIRED to write any classification override. */
export const classificationOverrideSchema = z.object({
  scope: z.enum(["attribute", "asset"]),
  targetId: z.number().int().positive(),
  levelCode: z.enum(CLASSIFICATION_CODES),
  rationale: z.string().trim().min(1, "A justification is required for every override."),
});
export type ClassificationOverrideInput = z.infer<typeof classificationOverrideSchema>;

/** A non-empty rationale is REQUIRED to resolve any review item. */
export const reviewDecisionSchema = z.object({
  reviewItemId: z.number().int().positive(),
  decision: z.enum(["accepted", "rejected", "overridden"]),
  rationale: z.string().trim().min(1, "A rationale is required to resolve a review item."),
  overrideLevelCode: z.enum(CLASSIFICATION_CODES).optional(),
});
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;

export const columnMappingSchema = z.object({
  sheetType: z.enum(["asset", "attribute"]),
  filename: z.string().min(1),
  mapping: z.record(z.string(), z.string().nullable()),
});
export type ColumnMappingInput = z.infer<typeof columnMappingSchema>;

export const runDetectionSchema = z.object({
  runId: z.string().optional(),
  useLlmLayer: z.boolean().default(true),
});

export const metadataCompletionSchema = z.object({
  attributeId: z.number().int().positive(),
  processingPurpose: z.string().optional(),
  consentStatus: z.string().optional(),
  accessControlLevel: z.string().optional(),
});

// --- Prompt 2 input schemas ------------------------------------------------

/** Selection-by-query: works across pagination without accumulating ids client-side. */
export const selectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("include"), ids: z.array(z.number().int()) }),
  z.object({
    mode: z.literal("all-matching"),
    filters: z.record(z.string(), z.any()).default({}),
    excluded: z.array(z.number().int()).default([]),
  }),
]);
export type Selection = z.infer<typeof selectionSchema>;

export const engineParamsSchema = z.object({
  confidenceThreshold: z.number().min(0).max(1).default(0.6),
  confidenceFloor: z.number().min(0).max(1).default(0.3),
  criteria: z.array(z.string()).optional(),
  includeArabic: z.boolean().default(true),
  batchSize: z.number().int().min(1).max(50).default(25),
  selfConsistencySamples: z.number().int().min(1).max(9).default(1),
  useCache: z.boolean().default(true),
  forceFresh: z.boolean().default(false),
  skipApproved: z.boolean().default(true),
  runNote: z.string().optional(),
});
export type EngineParams = z.infer<typeof engineParamsSchema>;

export const engineRunCreateSchema = z.object({
  engineType: z.enum(["pii", "classification"]),
  screen: z.enum(["assets", "attributes"]).default("attributes"),
  selection: selectionSchema,
  params: engineParamsSchema.partial().optional(),
});

export const runItemDecisionSchema = z
  .object({
    stewardDecision: z.enum(["accept", "reject", "override", "pending"]),
    overrideValue: z.record(z.string(), z.any()).optional(),
    rationale: z.string().optional(),
  })
  .refine((v) => v.stewardDecision !== "override" || Boolean(v.rationale && v.rationale.trim()), {
    message: "An override requires a rationale.",
    path: ["rationale"],
  });

export const bulkDecisionSchema = z.object({
  selection: selectionSchema,
  decision: z.enum(["accept", "reject", "override", "pending"]),
});

export const engineApproveSchema = z.object({
  justification: z.string().trim().min(10, "A run justification of at least 10 characters is required."),
});

export const frameworkPutSchema = z.object({
  definition: z.record(z.string(), z.any()),
  version: z.string().optional(),
  changeNote: z.string().optional(),
});

export const exportRequestSchema = z.object({
  screen: z.enum(["assets", "attributes"]),
  scope: z.object({
    kind: z.enum(["selection", "filter", "all"]),
    selection: selectionSchema.optional(),
    filters: z.record(z.string(), z.any()).optional(),
  }),
  columns: z.array(z.string()).min(1),
  format: z.enum(["xlsx"]).default("xlsx"),
});

export const importDecisionsSchema = z.object({
  selection: selectionSchema,
  status: z.enum(["accepted", "rejected"]),
});

export const importApproveSchema = engineApproveSchema;

export const savedViewSchema = z.object({
  screen: z.string(),
  name: z.string().min(1),
  filters: z.record(z.string(), z.any()),
  columns: z.array(z.string()).optional(),
  shared: z.boolean().default(false),
});
