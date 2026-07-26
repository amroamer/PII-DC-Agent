import { cn } from "@/lib/utils";
import { CLASSIFICATION_LEVELS, type ClassificationCode } from "@shared/lib/classification";
import { useLanguage } from "@/hooks/useLanguage";

const TOKEN_CLASS: Record<string, string> = {
  success: "bg-success/15 text-success border-success/30",
  muted: "bg-muted text-muted-foreground border-border",
  info: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
};

export function ClassificationBadge({
  code,
  className,
}: {
  code: ClassificationCode | null | undefined;
  className?: string;
}) {
  const { lang } = useLanguage();
  if (!code) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground",
          className,
        )}
      >
        {lang === "ar" ? "غير مصنّف" : "Unclassified"}
      </span>
    );
  }
  const def = CLASSIFICATION_LEVELS[code];
  const label = lang === "ar" ? def.labelAr : def.labelEn;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold",
        TOKEN_CLASS[def.colorToken] ?? TOKEN_CLASS.muted,
        className,
      )}
    >
      {label}
    </span>
  );
}
