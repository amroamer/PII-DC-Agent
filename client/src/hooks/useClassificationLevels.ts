import { useQuery } from "@tanstack/react-query";
import {
  CLASSIFICATION_LEVELS,
  type ClassificationLevelDef,
} from "@shared/lib/classification";

interface FrameworkResp {
  definition?: { levels?: Partial<ClassificationLevelDef>[] };
}

/**
 * Active classification levels (labels/colors/rank) from the classification framework,
 * so steward edits to a level's label or colour actually show in the UI. Falls back to
 * the hardcoded defaults per code when the framework is unavailable or a field is blank.
 * All callers share one query key, so any number of badges trigger a single request.
 */
export function useClassificationLevels(): Record<string, ClassificationLevelDef> {
  const { data } = useQuery<FrameworkResp>({
    queryKey: ["/api/frameworks/classification"],
    staleTime: 60_000,
  });
  const levels = data?.definition?.levels;
  if (!Array.isArray(levels) || levels.length === 0) return CLASSIFICATION_LEVELS;

  const map: Record<string, ClassificationLevelDef> = { ...CLASSIFICATION_LEVELS };
  for (const l of levels) {
    if (!l || typeof l.code !== "string" || !(l.code in map)) continue;
    const base = map[l.code];
    map[l.code] = {
      ...base,
      ...(typeof l.labelEn === "string" && l.labelEn.trim() ? { labelEn: l.labelEn } : {}),
      ...(typeof l.labelAr === "string" && l.labelAr.trim() ? { labelAr: l.labelAr } : {}),
      ...(typeof l.rank === "number" ? { rank: l.rank } : {}),
      ...(typeof l.colorToken === "string" && l.colorToken.trim() ? { colorToken: l.colorToken } : {}),
    };
  }
  return map;
}
