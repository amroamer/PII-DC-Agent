import { useCallback, useMemo, useState } from "react";
import type { FilterState } from "@shared/lib/filter-defs";

/** Selection-by-query — works across pagination without accumulating row ids. */
export type Selection =
  | { mode: "none" }
  | { mode: "include"; ids: number[] }
  | { mode: "all-matching"; filters: FilterState; excluded: number[] };

export function useSelection(filters: FilterState) {
  const [selection, setSelection] = useState<Selection>({ mode: "none" });

  const isSelected = useCallback(
    (id: number): boolean => {
      if (selection.mode === "none") return false;
      if (selection.mode === "include") return selection.ids.includes(id);
      return !selection.excluded.includes(id);
    },
    [selection],
  );

  const toggle = useCallback((id: number) => {
    setSelection((prev) => {
      if (prev.mode === "all-matching") {
        const excluded = prev.excluded.includes(id) ? prev.excluded.filter((x) => x !== id) : [...prev.excluded, id];
        return { ...prev, excluded };
      }
      const ids = prev.mode === "include" ? prev.ids : [];
      return ids.includes(id) ? { mode: "include", ids: ids.filter((x) => x !== id) } : { mode: "include", ids: [...ids, id] };
    });
  }, []);

  const togglePage = useCallback((pageIds: number[], allOnPageSelected: boolean) => {
    setSelection((prev) => {
      if (prev.mode === "all-matching") {
        const excluded = allOnPageSelected ? [...new Set([...prev.excluded, ...pageIds])] : prev.excluded.filter((x) => !pageIds.includes(x));
        return { ...prev, excluded };
      }
      const ids = prev.mode === "include" ? prev.ids : [];
      if (allOnPageSelected) return { mode: "include", ids: ids.filter((x) => !pageIds.includes(x)) };
      return { mode: "include", ids: [...new Set([...ids, ...pageIds])] };
    });
  }, []);

  const selectAllMatching = useCallback(() => {
    setSelection({ mode: "all-matching", filters, excluded: [] });
  }, [filters]);

  const clear = useCallback(() => setSelection({ mode: "none" }), []);

  const count = useCallback(
    (totalMatching: number): number => {
      if (selection.mode === "none") return 0;
      if (selection.mode === "include") return selection.ids.length;
      return Math.max(0, totalMatching - selection.excluded.length);
    },
    [selection],
  );

  const hasSelection = useMemo(
    () => selection.mode !== "none" && (selection.mode === "all-matching" || selection.ids.length > 0),
    [selection],
  );

  return { selection, isSelected, toggle, togglePage, selectAllMatching, clear, count, hasSelection };
}
