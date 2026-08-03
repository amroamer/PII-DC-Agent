import type { Express } from "express";
import { asyncHandler, HttpError, requireAdmin, requireAuth } from "../http";
import { savedViewSchema, selectionSchema, type User } from "@shared/models/schema";
import type { CatalogScreen, FilterState } from "@shared/lib/filter-defs";
import { listAssets, listAttributes, listScopeTables, distinctOptions, getFilterAvailability, resolveSelection } from "./query";
import { getAssetKpis, getAttributeKpis, getPiiDensity } from "./kpis";
import { wipeAllData } from "./wipe";
import { getAssetDetail, getAttributeDetail } from "./detail";
import {
  bulkCatalogAction,
  createSavedView,
  deleteSavedView,
  getColumnPrefs,
  listSavedViews,
  setColumnPrefs,
} from "./views";

function userId(req: { user?: unknown }): number | null {
  return (req.user as User | undefined)?.id ?? null;
}

function parseFilters(raw: unknown): FilterState {
  if (typeof raw !== "string" || raw === "") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as FilterState) : {};
  } catch {
    return {};
  }
}

function screenOf(raw: unknown): CatalogScreen {
  return raw === "assets" ? "assets" : "attributes";
}

export function registerCatalogRoutes(app: Express): void {
  // Hard reset — wipes ALL catalog + engine data (keeps users, config, frameworks,
  // data classes, saved views, and the audit log). Admin only. Irreversible.
  app.post(
    "/api/catalog/wipe",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const deleted = await wipeAllData(userId(req));
      res.json({ ok: true, deleted });
    }),
  );

  // Rich single-row detail for the catalog detail drawers.
  app.get(
    "/api/catalog/attributes/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const detail = await getAttributeDetail(Number(req.params.id));
      if (!detail) throw new HttpError(404, "Attribute not found.");
      res.json(detail);
    }),
  );
  app.get(
    "/api/catalog/assets/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const detail = await getAssetDetail(Number(req.params.id));
      if (!detail) throw new HttpError(404, "Asset not found.");
      res.json(detail);
    }),
  );

  app.get(
    "/api/catalog/assets",
    requireAuth,
    asyncHandler(async (req, res) => {
      const result = await listAssets({
        filters: parseFilters(req.query.filters),
        sort: typeof req.query.sort === "string" ? req.query.sort : undefined,
        dir: req.query.dir === "desc" ? "desc" : "asc",
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
      });
      res.json(result);
    }),
  );

  app.get(
    "/api/catalog/attributes",
    requireAuth,
    asyncHandler(async (req, res) => {
      const result = await listAttributes({
        filters: parseFilters(req.query.filters),
        sort: typeof req.query.sort === "string" ? req.query.sort : undefined,
        dir: req.query.dir === "desc" ? "desc" : "asc",
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
      });
      res.json(result);
    }),
  );

  // Tables (assets) matching the attribute filters, with per-table attribute counts —
  // the picklist for the run wizard's "Filter / pick tables" scope. Sort by attribute count.
  app.get(
    "/api/catalog/scope-tables",
    requireAuth,
    asyncHandler(async (req, res) => {
      const sort = req.query.sort === "name" ? "name" : "attributes";
      const dir = req.query.dir === "asc" ? "asc" : "desc";
      res.json(await listScopeTables(parseFilters(req.query.filters), sort, dir));
    }),
  );

  app.get(
    "/api/catalog/kpis",
    requireAuth,
    asyncHandler(async (req, res) => {
      const screen = screenOf(req.query.screen);
      const filters = parseFilters(req.query.filters);
      res.json(screen === "assets" ? await getAssetKpis(filters) : await getAttributeKpis(filters));
    }),
  );

  // PII density (E): concentration of personal data by business domain + top tables.
  app.get(
    "/api/catalog/pii-density",
    requireAuth,
    asyncHandler(async (req, res) => {
      const top = req.query.top ? Math.min(50, Math.max(1, Number(req.query.top))) : 20;
      res.json(await getPiiDensity(Number.isFinite(top) ? top : 20));
    }),
  );

  app.get(
    "/api/catalog/filter-options",
    requireAuth,
    asyncHandler(async (req, res) => {
      const screen = screenOf(req.query.screen);
      const key = typeof req.query.key === "string" ? req.query.key : "";
      if (!key) throw new HttpError(400, "key is required.");
      res.json(await distinctOptions(screen, key));
    }),
  );

  // Which availability-gated filters have data behind them (see filter-defs.ts).
  app.get(
    "/api/catalog/filter-availability",
    requireAuth,
    asyncHandler(async (_req, res) => {
      res.json(await getFilterAvailability());
    }),
  );

  app.post(
    "/api/catalog/resolve-selection",
    requireAuth,
    asyncHandler(async (req, res) => {
      const screen = screenOf(req.body?.screen);
      const parsed = selectionSchema.safeParse(req.body?.selection);
      if (!parsed.success) throw new HttpError(400, "Invalid selection.");
      const ids = await resolveSelection(screen, parsed.data);
      res.json({ count: ids.length, sample: ids.slice(0, 20) });
    }),
  );

  // Bulk direct-write actions (assign steward / add tag), audit-logged.
  app.post(
    "/api/catalog/bulk-action",
    requireAuth,
    asyncHandler(async (req, res) => {
      const screen = screenOf(req.body?.screen);
      const action = req.body?.action;
      const value = typeof req.body?.value === "string" ? req.body.value : "";
      if (action !== "assign-steward" && action !== "add-tag") throw new HttpError(400, "Unknown bulk action.");
      const parsed = selectionSchema.safeParse(req.body?.selection);
      if (!parsed.success) throw new HttpError(400, "Invalid selection.");
      const ids = await resolveSelection(screen, parsed.data);
      const changed = await bulkCatalogAction(screen, ids, action, value, userId(req));
      res.json({ changed });
    }),
  );

  // --- saved views ---------------------------------------------------------
  app.get(
    "/api/saved-views",
    requireAuth,
    asyncHandler(async (req, res) => {
      const screen = typeof req.query.screen === "string" ? req.query.screen : "attributes";
      res.json(await listSavedViews(userId(req), screen));
    }),
  );

  app.post(
    "/api/saved-views",
    requireAuth,
    asyncHandler(async (req, res) => {
      const parsed = savedViewSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Invalid saved view.");
      res.json(await createSavedView({ ...parsed.data, userId: userId(req) }));
    }),
  );

  app.delete(
    "/api/saved-views/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const ok = await deleteSavedView(Number(String(req.params.id)), userId(req));
      if (!ok) throw new HttpError(404, "View not found or not owned by you.");
      res.json({ ok: true });
    }),
  );

  // --- per-user column visibility -----------------------------------------
  app.get(
    "/api/settings/columns",
    requireAuth,
    asyncHandler(async (req, res) => {
      const screen = screenOf(req.query.screen);
      res.json({ columns: await getColumnPrefs(userId(req), screen) });
    }),
  );

  app.put(
    "/api/settings/columns",
    requireAuth,
    asyncHandler(async (req, res) => {
      const screen = screenOf(req.query.screen);
      const columns = Array.isArray(req.body?.columns) ? req.body.columns.map(String) : [];
      await setColumnPrefs(userId(req), screen, columns);
      res.json({ ok: true });
    }),
  );
}
