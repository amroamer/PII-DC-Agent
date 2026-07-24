import { cn } from "@/lib/utils";

/** Compact 0..1 confidence meter with a percentage label. */
export function ConfidenceBar({
  value,
  threshold = 0.6,
  className,
}: {
  value: number;
  threshold?: number;
  className?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const tone =
    value >= threshold ? "bg-success" : value >= threshold - 0.15 ? "bg-warning" : "bg-destructive";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-xs text-muted-foreground">{pct}%</span>
    </div>
  );
}
