/** UTC timestamp for spreadsheet metadata (deterministic, locale-independent). */
export function formatDateTime(date: Date): string {
  return `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}
