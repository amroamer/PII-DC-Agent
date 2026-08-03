/**
 * Saved views (Prompt 2 §2.3) + per-user column visibility prefs. A saved view
 * persists a filter set (+ chosen columns) per user, optionally shared with others.
 */
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "../db";
import { appSettings, assets, attributes, auditLog, savedViews, type SavedView } from "@shared/models/schema";
import type { CatalogScreen } from "@shared/lib/filter-defs";

export async function listSavedViews(userId: number | null, screen: string): Promise<SavedView[]> {
  return db
    .select()
    .from(savedViews)
    .where(
      and(
        eq(savedViews.screen, screen),
        userId != null ? or(eq(savedViews.userId, userId), eq(savedViews.shared, true)) : eq(savedViews.shared, true),
      ),
    )
    .orderBy(desc(savedViews.id));
}

export async function createSavedView(input: {
  userId: number | null;
  screen: string;
  name: string;
  filters: Record<string, unknown>;
  columns?: string[];
  shared: boolean;
}): Promise<SavedView> {
  const [row] = await db
    .insert(savedViews)
    .values({
      userId: input.userId ?? undefined,
      screen: input.screen,
      name: input.name,
      filters: input.filters,
      columns: input.columns,
      shared: input.shared,
    })
    .returning();
  return row;
}

export async function deleteSavedView(id: number, userId: number | null): Promise<boolean> {
  // Only the owner may delete their view.
  const result = await db
    .delete(savedViews)
    .where(and(eq(savedViews.id, id), userId != null ? eq(savedViews.userId, userId) : eq(savedViews.id, id)))
    .returning();
  return result.length > 0;
}

// --- per-user column visibility -------------------------------------------
// v2: the attribute column set changed (PII type / criterion / confidence / why),
// so prefs saved against the old set would hide the new columns from anyone who
// had ever touched the picker. Bumping the key resets to the defaults once.
function columnPrefKey(userId: number | null, screen: string): string {
  return `columns:${userId ?? "anon"}:v2:${screen}`;
}

export async function getColumnPrefs(userId: number | null, screen: string): Promise<string[] | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, columnPrefKey(userId, screen))).limit(1);
  return (row?.value as string[] | undefined) ?? null;
}

export async function setColumnPrefs(userId: number | null, screen: string, columns: string[]): Promise<void> {
  const key = columnPrefKey(userId, screen);
  await db.insert(appSettings).values({ key, value: columns }).onConflictDoUpdate({ target: appSettings.key, set: { value: columns } });
}

// --- bulk direct-write actions (Prompt 2 §5) ------------------------------
/**
 * Assign a steward or add a tag to the selected rows' ASSETS (audit-logged). For the
 * attributes screen the parent assets of the selected attributes are updated.
 */
export async function bulkCatalogAction(
  screen: CatalogScreen,
  ids: number[],
  action: "assign-steward" | "add-tag",
  value: string,
  actorId: number | null,
): Promise<number> {
  if (ids.length === 0 || !value.trim()) return 0;

  let assetIds: number[] = ids;
  if (screen === "attributes") {
    const rows = await db.select({ assetId: attributes.assetId }).from(attributes).where(inArray(attributes.id, ids));
    assetIds = [...new Set(rows.map((r) => r.assetId))];
  }

  const assetRows = await db.select().from(assets).where(inArray(assets.id, assetIds));
  let changed = 0;
  for (const asset of assetRows) {
    if (action === "assign-steward") {
      const stewards = [...new Set([...(asset.stewards ?? []), value])];
      await db.update(assets).set({ stewards }).where(eq(assets.id, asset.id));
      await db.insert(auditLog).values({
        actorId: actorId ?? undefined,
        action: "bulk_assign_steward",
        entityType: "asset",
        entityId: String(asset.id),
        before: { stewards: asset.stewards },
        after: { stewards },
        rationale: "Bulk steward assignment.",
        source: "steward",
      });
    } else {
      const tags = [...new Set([...(asset.tags ?? []), value])];
      await db.update(assets).set({ tags }).where(eq(assets.id, asset.id));
      await db.insert(auditLog).values({
        actorId: actorId ?? undefined,
        action: "bulk_add_tag",
        entityType: "asset",
        entityId: String(asset.id),
        before: { tags: asset.tags },
        after: { tags },
        rationale: "Bulk tag addition.",
        source: "steward",
      });
    }
    changed++;
  }
  return changed;
}
