import { getDataClasses, type CachedDataClass } from "../reference-cache";

/** Match an IKC-assigned class name/code against the PDTC data-class library. */
export function matchByName(
  name: string,
  source?: "ikc" | "adc",
): CachedDataClass | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  for (const dc of getDataClasses(source)) {
    if (dc.code.toLowerCase() === n) return dc;
    if (dc.nameEn.toLowerCase() === n) return dc;
    if (dc.nameAr === name.trim()) return dc;
    if (dc.detectionHints.some((h) => h.toLowerCase() === n)) return dc;
  }
  return null;
}

/** Keyword match of free-text metadata (column name + description) onto a class. */
export function matchByKeywords(
  text: string,
  source?: "ikc" | "adc",
): { dataClass: CachedDataClass; matchedHints: string[] } | null {
  const haystack = text.toLowerCase();
  if (!haystack.trim()) return null;
  for (const dc of getDataClasses(source)) {
    const matched = dc.detectionHints.filter((h) => haystack.includes(h.toLowerCase()));
    if (matched.length > 0) return { dataClass: dc, matchedHints: matched };
  }
  return null;
}
