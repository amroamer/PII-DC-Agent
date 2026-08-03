/**
 * Backfill for the "PII with no criterion" state.
 *
 * A `pii` detection with a NULL criterion_code cannot be filtered by criterion,
 * exported defensibly, or actioned by a steward — it renders as a blank
 * "Criteria Matched" cell. The engine no longer produces them (see the
 * unattributedPii guard in server/engine/infer.ts and the backstop in
 * server/engine/approve.ts), but rows written by earlier runs are still in the
 * table. This converts them.
 *
 * They become `uncertain`, NOT `not_pii`: an all-criteria re-check showed several
 * are genuinely personal (employee photo, religion, passport image) and were only
 * unattributed because the run was scoped to DIRECT_ID + INDIRECT_ID. Asserting
 * "not personal" would be the more dangerous error. `uncertain` removes them from
 * the PII inventory and routes them to a steward.
 *
 * Idempotent: a second run finds nothing to do. Pass --dry-run to preview.
 *
 *   npx tsx script/fix-unattributed-pii.ts [--dry-run]
 */
import { and, eq, isNull, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { appendAudit } from "../server/audit";
import { attributes, detections } from "@shared/models/schema";

const NOTE =
  "Reclassified from pii to uncertain: the engine judged this column personal but no criterion in the run's scope applied, leaving the finding unattributed. Held for steward review.";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const rows = await db
    .select({
      id: detections.id,
      attributeId: detections.attributeId,
      runId: detections.runId,
      confidence: detections.confidence,
      columnName: attributes.columnName,
    })
    .from(detections)
    .innerJoin(attributes, eq(attributes.id, detections.attributeId))
    .where(and(eq(detections.verdict, "pii"), isNull(detections.criterionCode)));

  if (rows.length === 0) {
    console.log("Nothing to fix — no pii detections without a criterion.");
    return;
  }

  const attributeIds = [...new Set(rows.map((r) => r.attributeId))];
  console.log(`Found ${rows.length} unattributed pii detections across ${attributeIds.length} attributes.`);
  for (const r of rows.slice(0, 10)) {
    console.log(`  - ${r.columnName} (attribute ${r.attributeId}, run ${r.runId}, confidence ${r.confidence.toFixed(2)})`);
  }
  if (rows.length > 10) console.log(`  … and ${rows.length - 10} more`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(detections)
      .set({ verdict: "uncertain" })
      .where(inArray(detections.id, rows.map((r) => r.id)));
  });

  // One audit row per affected attribute — the log is the record of WHY the
  // catalog's PII count moved.
  for (const attributeId of attributeIds) {
    await appendAudit({
      action: "detection.unattributed_pii_downgraded",
      entityType: "attribute",
      entityId: attributeId,
      before: { verdict: "pii", criterionCode: null },
      after: { verdict: "uncertain", criterionCode: null },
      rationale: NOTE,
      source: "system",
    });
  }

  console.log(`\nUpdated ${rows.length} detections on ${attributeIds.length} attributes to 'uncertain'.`);
  console.log(`Wrote ${attributeIds.length} audit entries.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
