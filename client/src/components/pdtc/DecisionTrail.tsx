import { History } from "lucide-react";
import { formatDateTime } from "@/lib/formatDate";
import { EmptyState } from "./EmptyState";

export interface DecisionTrailEntry {
  id: number;
  action: string;
  entityType: string;
  entityId: string;
  rationale: string | null;
  createdAt: string | Date;
}

/** Vertical timeline of append-only audit_log decisions. */
export function DecisionTrail({ entries }: { entries: DecisionTrailEntry[] }) {
  if (entries.length === 0) {
    return <EmptyState icon={<History className="h-6 w-6" />} title="No decisions recorded yet" />;
  }

  return (
    <ol className="relative space-y-4 border-s ps-5">
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span className="absolute -start-[27px] top-1 h-3 w-3 rounded-full border-2 border-background bg-primary" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{entry.action.replace(/_/g, " ")}</span>
            <span className="text-xs text-muted-foreground">
              {entry.entityType} #{entry.entityId}
            </span>
            <span className="ms-auto text-xs text-muted-foreground">
              {formatDateTime(entry.createdAt)}
            </span>
          </div>
          {entry.rationale && (
            <p className="mt-0.5 text-sm text-muted-foreground">{entry.rationale}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
