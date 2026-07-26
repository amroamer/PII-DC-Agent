import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/formatDate";
import { useLanguage } from "@/hooks/useLanguage";

/** A titled group in a detail drawer tab. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

/** Bordered, divided container for a run of Field / row items. */
export function FieldList({ children }: { children: ReactNode }) {
  return <div className="divide-y rounded-md border">{children}</div>;
}

/** A label / value row. Renders nothing when the value is empty. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="grid grid-cols-3 gap-3 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2 break-words">{children}</span>
    </div>
  );
}

/** Collapsible raw IKC source row (the untouched imported record). */
export function RawRow({ row }: { row: Record<string, unknown> | null | undefined }) {
  const { lang } = useLanguage();
  if (!row) return null;
  return (
    <details className="rounded-md border">
      <summary className="cursor-pointer p-3 text-sm text-muted-foreground">
        {lang === "ar" ? "الصف الأصلي (IKC)" : "Raw IKC row"}
      </summary>
      <pre className="overflow-x-auto border-t p-3 text-xs">{JSON.stringify(row, null, 2)}</pre>
    </details>
  );
}

export interface AuditEntryView {
  id: number;
  action: string;
  source: string;
  rationale: string | null;
  createdAt: string;
}

export function AuditList({ entries }: { entries: AuditEntryView[] }) {
  const { lang } = useLanguage();
  if (!entries?.length) {
    return <p className="text-sm text-muted-foreground">{lang === "ar" ? "لا يوجد سجل بعد." : "No history yet."}</p>;
  }
  return (
    <ol className="space-y-2">
      {entries.map((e) => (
        <li key={e.id} className="rounded-md border p-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{e.action}</span>
            <span className="text-xs text-muted-foreground">{formatDateTime(e.createdAt)}</span>
          </div>
          <div className="text-xs text-muted-foreground">{e.source}{e.rationale ? ` · ${e.rationale}` : ""}</div>
        </li>
      ))}
    </ol>
  );
}
