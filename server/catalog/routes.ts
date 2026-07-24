import type { Express } from "express";
import { asyncHandler, HttpError, requireAuth } from "../http";
import { savedViewSchema, selectionSchema, type User } from "@shared/models/schema";
import type { CatalogScreen, FilterState } from "@shared/lib/filter-defs";
import { listAssets, listAttributes, distinctOptions, resolveSelection } from "./query";
import { getAssetKpis, getAttributeKpis } from "./kpis";
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

  app.get(
    "/api/catalog/kpis",
    requireAuth,
    asyncHandler(async (req, res) => {
      const screen = screenOf(req.query.screen);
      const filters = parseFilters(req.query.filters);
      res.json(screen === "assets" ? await getAssetKpis(filters) : await getAttributeKpis(filters));
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
