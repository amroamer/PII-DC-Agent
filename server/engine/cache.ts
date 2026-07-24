/**
 * Result cache (Prompt 2 §7.3). Every inference checks here first; a hit returns the
 * stored response and makes no network call. A framework/prompt/model version change
 * changes the hash and naturally invalidates affected entries — without retroactively
 * altering any already-approved catalog record.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { llmCache, type LlmCacheRow } from "@shared/models/schema";

export async function getCached(inputHash: string): Promise<LlmCacheRow | undefined> {
  const [row] = await db.select().from(llmCache).where(eq(llmCache.inputHash, inputHash)).limit(1);
  if (row) {
    await db
      .update(llmCache)
      .set({ hitCount: sql`${llmCache.hitCount} + 1`, lastHitAt: new Date() })
      .where(eq(llmCache.inputHash, inputHash));
  }
  return row;
}

export interface CachePutInput {
  inputHash: string;
  response: Record<string, unknown>;
  modelId: string;
  promptVersion: string;
  frameworkVersionId: number | null;
  engineVersion: string;
  schemaVersion: string;
  tokensUsed?: number;
}

export async function putCache(entry: CachePutInput): Promise<void> {
  await db
    .insert(llmCache)
    .values({
      inputHash: entry.inputHash,
      response: entry.response,
      modelId: entry.modelId,
      promptVersion: entry.promptVersion,
      frameworkVersionId: entry.frameworkVersionId ?? undefined,
      engineVersion: entry.engineVersion,
      schemaVersion: entry.schemaVersion,
      tokensUsed: entry.tokensUsed ?? 0,
    })
    .onConflictDoNothing();
}

export async function cacheStats() {
  const [row] = await db
    .select({
      entries: sql<number>`count(*)::int`,
      totalHits: sql<number>`coalesce(sum(${llmCache.hitCount}), 0)::int`,
      sizeBytes: sql<number>`coalesce(sum(length(${llmCache.response}::text)), 0)::int`,
    })
    .from(llmCache);
  const entries = row?.entries ?? 0;
  const totalHits = row?.totalHits ?? 0;
  // Each entry corresponds to exactly one creating miss, so lookups = entries + hits.
  const hitRate = entries + totalHits > 0 ? totalHits / (entries + totalHits) : 0;
  return { entries, totalHits, sizeBytes: row?.sizeBytes ?? 0, hitRate: Number(hitRate.toFixed(3)) };
}

export async function clearCache(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(llmCache);
  await db.delete(llmCache);
  return row?.n ?? 0;
}
