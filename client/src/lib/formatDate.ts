import { format, formatDistanceToNow, parseISO } from "date-fns";

/** The single date-formatting helper for the app. Never inline new Date().toLocaleString(). */
function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? new Date(value) : parsed;
}

export function formatDate(value: Date | string | number | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, "dd MMM yyyy") : "—";
}

export function formatDateTime(value: Date | string | number | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, "dd MMM yyyy · HH:mm") : "—";
}

export function formatRelative(value: Date | string | number | null | undefined): string {
  const date = toDate(value);
  return date ? formatDistanceToNow(date, { addSuffix: true }) : "—";
}
