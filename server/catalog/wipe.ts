/**
 * Hard reset of ALL catalog + engine data. Wipes ingested assets/attributes and
 * every derived artifact (detections, classifications, review items, engine runs,
 * caches, and ingest/import/export history). KEEPS reference & config: users,
 * app settings, prompts, data classes, policy criteria, ISMS levels, the PII /
 * classification frameworks, saved views, and the append-only audit log — the wipe
 * itself is recorded there. Irreversible.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { assets, attributes, classifications, detections } from "@shared/models/schema";
import { appendAudit } from "../audit";
import { invalidateDistinctCache } from "./query";

export interface WipeResult {
  assets: number;
  attributes: number;
  detections: number;
  classifications: number;
}

export async function wipeAllData(actorId: number | null): Promise<WipeResult> {
  const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(assets);
  const [at] = await db.select({ n: sql<number>`count(*)::int` }).from(attributes);
  const [d] = await db.select({ n: sql<number>`count(*)::int` }).from(detections);
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(classifications);
  const before: WipeResult = {
    assets: a?.n ?? 0,
    attributes: at?.n ?? 0,
    detections: d?.n ?? 0,
    classifications: c?.n ?? 0,
  };

  // One statement; CASCADE resolves FK order among the data tables, RESTART IDENTITY
  // resets sequences so a fresh import starts from id 1. audit_log is intentionally
  // NOT listed (append-only) and has no FK into these tables, so CASCADE won't reach it.
  await db.execute(sql`
    TRUNCATE TABLE
      detections, classifications, cooccurrence_findings, criterion_assessments,
      run_items, review_items, metadata_completion, engine_runs, ingest_runs,
      writeback_batches, export_batches, import_diffs, import_batches, stored_files,
      llm_cache, attributes, assets
    RESTART IDENTITY CASCADE
  `);

  invalidateDistinctCache();
  await appendAudit({
    actorId,
    action: "wipe_all_data",
    entityType: "system",
    entityId: "catalog",
    before,
    rationale: "Hard reset — all catalog and engine data deleted via admin wipe.",
    source: "system",
  });

  return before;
}
