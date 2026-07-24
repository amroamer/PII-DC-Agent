/**
 * Classification persistence with supersede semantics. A classification decision
 * is NEVER mutated in place: a new row is inserted and the previous active row's
 * `supersededBy` pointer is set. A manual override always wins over a computed
 * rollup — on the next run the engine re-evaluates and FLAGS divergence rather
 * than overwriting the override.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  classifications,
  type Classification,
  type ClassificationScope,
} from "@shared/models/schema";
import type { ClassificationCode } from "@shared/lib/classification";
import { appendAudit } from "../audit";

export async function getActiveClassification(
  scope: ClassificationScope,
  targetId: number,
): Promise<Classification | undefined> {
  const [row] = await db
    .select()
    .from(classifications)
    .where(
      and(
        eq(classifications.scope, scope),
        eq(classifications.targetId, targetId),
        isNull(classifications.supersededBy),
      ),
    )
    .orderBy(desc(classifications.createdAt))
    .limit(1);
  return row;
}

export interface WriteComputedInput {
  scope: ClassificationScope;
  targetId: number;
  level: ClassificationCode;
  derivedFrom: "engine" | "rollup";
  rationale: string;
}

export interface WriteResult {
  effectiveLevel: ClassificationCode;
  diverged: boolean;
  rowId: number | null;
}

export async function writeComputedClassification(
  input: WriteComputedInput,
): Promise<WriteResult> {
  const active = await getActiveClassification(input.scope, input.targetId);

  // Override wins: keep it active, flag (don't overwrite) any divergence.
  if (active && active.derivedFrom === "override") {
    const diverged = active.levelCode !== input.level;
    if (diverged) {
      await appendAudit({
        actorId: null,
        action: "classification_override_divergence",
        entityType: input.scope,
        entityId: input.targetId,
        before: { override: active.levelCode },
        after: { engine: input.level },
        rationale: `Recomputed engine level (${input.level}) diverges from the active override (${active.levelCode}); override retained.`,
      });
    }
    return { effectiveLevel: active.levelCode, diverged, rowId: active.id };
  }

  const [inserted] = await db
    .insert(classifications)
    .values({
      scope: input.scope,
      targetId: input.targetId,
      levelCode: input.level,
      derivedFrom: input.derivedFrom,
      rationale: input.rationale,
    })
    .returning();

  if (active) {
    await db
      .update(classifications)
      .set({ supersededBy: inserted.id })
      .where(eq(classifications.id, active.id));
  }

  return { effectiveLevel: input.level, diverged: false, rowId: inserted.id };
}
