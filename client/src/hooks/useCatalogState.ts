import { useCallback, useEffect, useState } from "react";
import type { FilterState } from "@shared/lib/filter-defs";

export interface CatalogState {
  filters: FilterState;
  search: string;
  sort: string;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

/**
 * URL-synced catalog state (Prompt 2 §1) — filters, sort, page and search all live
 * in the query string, so a filtered view is shareable and survives refresh. State
 * is mirrored to the URL with history.replaceState (no navigation/history spam).
 */
function readInitial(screen: string): CatalogState {
  const params = new URLSearchParams(window.location.search);
  let filters: FilterState = {};
  try {
    if (params.get(`${screen}.f`)) filters = JSON.parse(params.get(`${screen}.f`)!);
  } catch {
    filters = {};
  }
  return {
    filters,
    search: params.get(`${screen}.q`) ?? "",
    sort: params.get(`${screen}.sort`) ?? "",
    dir: params.get(`${screen}.dir`) === "desc" ? "desc" : "asc",
    page: Number(params.get(`${screen}.page`)) || 1,
    pageSize: Number(params.get(`${screen}.ps`)) || 50,
  };
}

export function useCatalogState(screen: string) {
  const [state, setState] = useState<CatalogState>(() => readInitial(screen));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (Object.keys(state.filters).length) params.set(`${screen}.f`, JSON.stringify(state.filters));
    else params.delete(`${screen}.f`);
    if (state.search) params.set(`${screen}.q`, state.search);
    else params.delete(`${screen}.q`);
    if (state.sort) params.set(`${screen}.sort`, state.sort);
    else params.delete(`${screen}.sort`);
    params.set(`${screen}.dir`, state.dir);
    params.set(`${screen}.page`, String(state.page));
    params.set(`${screen}.ps`, String(state.pageSize));
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [screen, state]);

  const patchFilter = useCallback((key: string, value: unknown) => {
    setState((s) => {
      const filters = { ...s.filters };
      if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
        delete filters[key];
      } else {
        filters[key] = value;
      }
      return { ...s, filters, page: 1 };
    });
  }, []);

  const setSearch = useCallback((search: string) => setState((s) => ({ ...s, search, page: 1 })), []);
  const setSort = useCallback((sort: string, dir: "asc" | "desc") => setState((s) => ({ ...s, sort, dir })), []);
  const setPage = useCallback((page: number) => setState((s) => ({ ...s, page })), []);
  const clearFilters = useCallback(() => setState((s) => ({ ...s, filters: {}, search: "", page: 1 })), []);
  const setFilters = useCallback((filters: FilterState) => setState((s) => ({ ...s, filters, page: 1 })), []);

  // The effective filter set sent to the server includes free-text search.
  const effectiveFilters: FilterState = { ...state.filters, ...(state.search ? { search: state.search } : {}) };

  return { state, effectiveFilters, patchFilter, setSearch, setSort, setPage, clearFilters, setFilters };
}
