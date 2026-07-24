import { cn } from "@/lib/utils";
import { POLICY_CRITERIA, type CriterionCode } from "@shared/lib/criteria";
import { useLanguage } from "@/hooks/useLanguage";

const CRITERION_TONE: Record<CriterionCode, string> = {
  DIRECT_ID: "bg-destructive/15 text-destructive border-destructive/30",
  INDIRECT_ID: "bg-warning/15 text-warning border-warning/30",
  REGULATORY: "bg-primary/15 text-primary border-primary/30",
  CONTEXTUAL: "bg-muted text-muted-foreground border-border",
  SPECIAL_CATEGORY: "bg-destructive/20 text-destructive border-destructive/40",
};

export function CriterionBadge({
  code,
  className,
}: {
  code: CriterionCode;
  className?: string;
}) {
  const { lang } = useLanguage();
  const def = POLICY_CRITERIA[code];
  const label = lang === "ar" ? def.nameAr : def.nameEn;
  return (
    <span
      title={def.description}
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        CRITERION_TONE[code],
        className,
      )}
    >
      {label}
    </span>
  );
}
