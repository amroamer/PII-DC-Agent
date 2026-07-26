/**
 * Multi-value asset facets (businessDomain, subjectArea, …) are stored as jsonb
 * `string[]` (parsed from IKC list literals at import). The engines and exports want
 * a single human-readable context string; this joins the array with `sep`, tolerates a
 * legacy scalar string, and collapses empty to null.
 */
export function joinFacet(value: string[] | string | null | undefined, sep = "; "): string | null {
  if (value == null) return null;
  const s = Array.isArray(value) ? value.join(sep) : String(value);
  return s.trim() === "" ? null : s;
}
