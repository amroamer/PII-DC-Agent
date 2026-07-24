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
  type Framework,
  type FrameworkType,
  type FrameworkVersion,
} from "@shared/models/schema";
import { POLICY_CRITERIA_LIST } from "@shared/lib/criteria";
import { CLASSIFICATION_LEVELS_LIST } from "@shared/lib/classification";
import { DEFAULT_CLASSIFICATION_RULES } from "../classification-engine/attribute-rules";

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
      principles: [
        "Lawfulness, fairness, transparency",
        "Purpose limitation",
        "Data minimisation",
        "Accuracy",
        "Storage limitation",
        "Integrity and confidentiality",
        "Accountability",
      ],
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
