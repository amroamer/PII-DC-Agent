/**
 * Framework storage + immutable versioning (Prompt 2 §10.2/§10.3). Every save
 * creates a new framework_versions row; approved runs are pinned to the version
 * they used. Editing a framework never mutates a prior version.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  frameworks,
  frameworkVersions,
  type DetectionVerdict,
  type Framework,
  type FrameworkType,
  type FrameworkVersion,
} from "@shared/models/schema";
import {
  POLICY_CRITERIA_LIST,
  isCriterionCode,
  type CriterionCode,
  type CriterionDef,
} from "@shared/lib/criteria";
import {
  CLASSIFICATION_CODES,
  CLASSIFICATION_LEVELS,
  CLASSIFICATION_LEVELS_LIST,
  isClassificationCode,
  type ClassificationLevelDef,
} from "@shared/lib/classification";
import {
  DEFAULT_CLASSIFICATION_RULES,
  type ClassificationRule,
} from "../classification-engine/attribute-rules";

export interface ActiveFramework {
  id: number | null;
  version: string;
  definition: Record<string, unknown>;
}

export function defaultDefinition(type: FrameworkType): Record<string, unknown> {
  if (type === "pii") {
    return {
      version: "1.0",
      effective: "2025-09-25",
      criteria: POLICY_CRITERIA_LIST,
    };
  }
  return {
    version: "1.0",
    levels: CLASSIFICATION_LEVELS_LIST,
    rules: DEFAULT_CLASSIFICATION_RULES,
    rollup: "high-water-mark; ties resolve to the more restrictive level",
  };
}

/** Idempotently ensure a framework + an initial immutable version exist. */
export async function ensureFramework(type: FrameworkType): Promise<void> {
  const [existing] = await db.select().from(frameworks).where(eq(frameworks.type, type)).limit(1);
  if (existing?.activeVersionId) return;

  const framework: Framework =
    existing ??
    (await db.insert(frameworks).values({ type }).returning())[0];

  const [version] = await db
    .insert(frameworkVersions)
    .values({
      frameworkId: framework.id,
      version: "1.0",
      definition: defaultDefinition(type),
      changeNote: "Seeded default framework.",
    })
    .returning();

  await db.update(frameworks).set({ activeVersionId: version.id }).where(eq(frameworks.id, framework.id));
}

/** Decorated version label for the version a run was pinned to (for provenance). */
export async function frameworkVersionLabel(
  type: FrameworkType,
  versionId: number | null,
): Promise<string> {
  if (versionId) {
    const [ver] = await db.select().from(frameworkVersions).where(eq(frameworkVersions.id, versionId)).limit(1);
    if (ver) return `${type}-${ver.version}`;
  }
  return (await getActiveFrameworkVersion(type)).version;
}

export async function getActiveFrameworkVersion(type: FrameworkType): Promise<ActiveFramework> {
  const [fw] = await db.select().from(frameworks).where(eq(frameworks.type, type)).limit(1);
  if (fw?.activeVersionId) {
    const [ver] = await db.select().from(frameworkVersions).where(eq(frameworkVersions.id, fw.activeVersionId)).limit(1);
    if (ver) return { id: ver.id, version: `${type}-${ver.version}`, definition: ver.definition };
  }
  return { id: null, version: `${type}-1.0`, definition: defaultDefinition(type) };
}

export async function listVersions(type: FrameworkType): Promise<FrameworkVersion[]> {
  const [fw] = await db.select().from(frameworks).where(eq(frameworks.type, type)).limit(1);
  if (!fw) return [];
  return db.select().from(frameworkVersions).where(eq(frameworkVersions.frameworkId, fw.id)).orderBy(desc(frameworkVersions.createdAt));
}

export async function createVersion(
  type: FrameworkType,
  definition: Record<string, unknown>,
  changeNote: string | undefined,
  authorId: number | null,
): Promise<FrameworkVersion> {
  await ensureFramework(type);
  const [fw] = await db.select().from(frameworks).where(eq(frameworks.type, type)).limit(1);
  const prior = await listVersions(type);
  // Max-derived minor bump (robust to gaps / concurrent history), not length-derived.
  const maxMinor = prior.reduce((max, v) => {
    const minor = Number.parseInt(v.version.split(".")[1] ?? "", 10);
    return Number.isNaN(minor) ? max : Math.max(max, minor);
  }, -1);
  const nextVersion = `1.${maxMinor + 1}`;

  const [version] = await db
    .insert(frameworkVersions)
    .values({ frameworkId: fw.id, version: nextVersion, definition, changeNote, authorId: authorId ?? undefined })
    .returning();
  await db.update(frameworks).set({ activeVersionId: version.id }).where(eq(frameworks.id, fw.id));
  return version;
}

export async function restoreVersion(type: FrameworkType, versionId: number): Promise<FrameworkVersion | null> {
  const [fw] = await db.select().from(frameworks).where(eq(frameworks.type, type)).limit(1);
  if (!fw) return null;
  const [ver] = await db.select().from(frameworkVersions).where(eq(frameworkVersions.id, versionId)).limit(1);
  if (!ver || ver.frameworkId !== fw.id) return null;
  // Restore = create a NEW version from the old definition (prior versions stay immutable).
  return createVersion(type, ver.definition, `Restored from version ${ver.version}.`, ver.authorId ?? null);
}

// ---------------------------------------------------------------------------
// Authoritative accessors — the engines read criteria / rules from the ACTIVE
// framework version so steward edits actually change engine behaviour. Each
// coerces the stored jsonb and falls back to the code default if it is missing
// or malformed, so a bad edit can never crash a run.
// ---------------------------------------------------------------------------

const DETECTION_VERDICTS: readonly DetectionVerdict[] = ["pii", "not_pii", "uncertain"];
function isDetectionVerdict(v: unknown): v is DetectionVerdict {
  return typeof v === "string" && (DETECTION_VERDICTS as readonly string[]).includes(v);
}

function coerceRule(raw: unknown): ClassificationRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !isClassificationCode(r.level)) return null;
  if (r.criterion !== undefined && !isCriterionCode(r.criterion)) return null;
  if (r.verdict !== undefined && !isDetectionVerdict(r.verdict)) return null;
  if (r.isSpecialCategory !== undefined && typeof r.isSpecialCategory !== "boolean") return null;
  return {
    id: r.id,
    level: r.level,
    note: typeof r.note === "string" ? r.note : "",
    ...(r.criterion !== undefined ? { criterion: r.criterion as CriterionCode } : {}),
    ...(r.verdict !== undefined ? { verdict: r.verdict as DetectionVerdict } : {}),
    ...(r.isSpecialCategory !== undefined ? { isSpecialCategory: r.isSpecialCategory as boolean } : {}),
  };
}

function coerceCriterion(raw: unknown): CriterionDef | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (!isCriterionCode(c.code)) return null;
  const mode = c.evaluationMode === "intrinsic" ? "intrinsic" : "contextual";
  return {
    code: c.code,
    nameEn: typeof c.nameEn === "string" ? c.nameEn : c.code,
    nameAr: typeof c.nameAr === "string" ? c.nameAr : "",
    description: typeof c.description === "string" ? c.description : "",
    evaluationMode: mode,
  };
}

/** Classification rules from the active framework version (fallback: code default). */
export async function getActiveClassificationRules(): Promise<ClassificationRule[]> {
  const { definition } = await getActiveFrameworkVersion("classification");
  const raw = definition.rules;
  const rules = Array.isArray(raw)
    ? raw.map(coerceRule).filter((r): r is ClassificationRule => r !== null)
    : [];
  return rules.length > 0 ? rules : DEFAULT_CLASSIFICATION_RULES;
}

function coerceLevel(raw: unknown): ClassificationLevelDef | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  if (!isClassificationCode(l.code)) return null;
  const fallback = CLASSIFICATION_LEVELS[l.code];
  return {
    code: l.code,
    labelEn: typeof l.labelEn === "string" && l.labelEn.trim() ? l.labelEn : fallback.labelEn,
    labelAr: typeof l.labelAr === "string" && l.labelAr.trim() ? l.labelAr : fallback.labelAr,
    rank: typeof l.rank === "number" && Number.isFinite(l.rank) ? l.rank : fallback.rank,
    colorToken: typeof l.colorToken === "string" && l.colorToken.trim() ? l.colorToken : fallback.colorToken,
  };
}

/**
 * Classification levels (labels/colors/rank) from the active framework version. Guards the
 * enum: if the edited set is not exactly the canonical codes, the code default is used, so a
 * malformed import can never break level handling. Lets engine output use edited labels.
 */
export async function getActiveClassificationLevels(): Promise<ClassificationLevelDef[]> {
  const { definition } = await getActiveFrameworkVersion("classification");
  const raw = definition.levels;
  const levels = Array.isArray(raw)
    ? raw.map(coerceLevel).filter((l): l is ClassificationLevelDef => l !== null)
    : [];
  const codes = new Set(levels.map((l) => l.code));
  const canonical = codes.size === CLASSIFICATION_CODES.length && CLASSIFICATION_CODES.every((c) => codes.has(c));
  return canonical ? levels : CLASSIFICATION_LEVELS_LIST;
}

/** PII criterion definitions from the active framework version (fallback: code default). */
export async function getActivePiiCriteria(): Promise<CriterionDef[]> {
  const { definition } = await getActiveFrameworkVersion("pii");
  const raw = definition.criteria;
  const criteria = Array.isArray(raw)
    ? raw.map(coerceCriterion).filter((c): c is CriterionDef => c !== null)
    : [];
  return criteria.length > 0 ? criteria : POLICY_CRITERIA_LIST;
}

/** Order-independent structural equality of two framework definitions. */
function definitionsEqual(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): string =>
    JSON.stringify(v, (_k, val) =>
      val && typeof val === "object" && !Array.isArray(val)
        ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)))
        : val,
    );
  return norm(a) === norm(b);
}

/**
 * Keep the AUTO-SEEDED (author-less) active version in line with the current code
 * default. While the packaged framework is still being developed we refresh that
 * seeded version IN PLACE — no new version is minted — so it always mirrors the
 * code and stays on its original label (v1.0). A version authored by a steward
 * (authorId set) is never auto-touched; formal immutable versioning begins there.
 */
export async function reconcileFramework(type: FrameworkType): Promise<void> {
  await ensureFramework(type);
  const [fw] = await db.select().from(frameworks).where(eq(frameworks.type, type)).limit(1);
  if (!fw?.activeVersionId) return;
  const [active] = await db
    .select()
    .from(frameworkVersions)
    .where(eq(frameworkVersions.id, fw.activeVersionId))
    .limit(1);
  if (!active || active.authorId != null) return; // steward-edited -> leave it alone
  const target = defaultDefinition(type);
  if (definitionsEqual(active.definition, target)) return;
  await db
    .update(frameworkVersions)
    .set({ definition: target })
    .where(eq(frameworkVersions.id, active.id));
}
