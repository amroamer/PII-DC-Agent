/**
 * Steward override. REQUIRES a non-empty rationale (enforced by
 * classificationOverrideSchema at the zod layer). Writes a NEW classifications row
 * (never mutates the old decision — sets supersededBy on the previous row) and an
 * append-only audit_log entry.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  classifications,
  type Classification,
  type ClassificationOverrideInput,
} from "@shared/models/schema";
import { getActiveClassification } from "./store";
import { appendAudit } from "../audit";

export async function applyClassificationOverride(
  input: ClassificationOverrideInput,
  actorId: number | null,
): Promise<Classification> {
  const active = await getActiveClassification(input.scope, input.targetId);

  const [inserted] = await db
    .insert(classifications)
    .values({
      scope: input.scope,
      targetId: input.targetId,
      levelCode: input.levelCode,
      derivedFrom: "override",
      rationale: input.rationale,
    })
    .returning();

  if (active) {
    await db
      .update(classifications)
      .set({ supersededBy: inserted.id })
      .where(eq(classifications.id, active.id));
  }

  await appendAudit({
    actorId,
    action: "classification_override",
    entityType: input.scope,
    entityId: input.targetId,
    before: active ? { levelCode: active.levelCode, derivedFrom: active.derivedFrom } : null,
    after: { levelCode: input.levelCode, derivedFrom: "override" },
    rationale: input.rationale,
    source: "steward",
  });

  return inserted;
}
