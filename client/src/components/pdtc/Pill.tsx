import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { DetectionVerdict } from "@shared/models/schema";
import { useLanguage } from "@/hooks/useLanguage";

const pillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
  {
    variants: {
      tone: {
        pii: "bg-destructive/15 text-destructive",
        not_pii: "bg-success/15 text-success",
        uncertain: "bg-warning/15 text-warning",
        neutral: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface PillProps extends VariantProps<typeof pillVariants> {
  className?: string;
  children?: React.ReactNode;
}

export function Pill({ tone, className, children }: PillProps) {
  return <span className={cn(pillVariants({ tone }), className)}>{children}</span>;
}

/** Verdict pill that resolves its own bilingual label. */
export function VerdictPill({ verdict }: { verdict: DetectionVerdict }) {
  const { t } = useLanguage();
  return <Pill tone={verdict}>{t(`verdict.${verdict}`)}</Pill>;
}
