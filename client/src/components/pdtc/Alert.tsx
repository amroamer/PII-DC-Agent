import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type AlertTone = "info" | "success" | "warning" | "error";

const toneStyles: Record<AlertTone, { wrap: string; icon: React.ReactNode }> = {
  info: { wrap: "border-primary/30 bg-accent text-accent-foreground", icon: <Info className="h-4 w-4" /> },
  success: { wrap: "border-success/40 bg-success/10 text-foreground", icon: <CheckCircle2 className="h-4 w-4 text-success" /> },
  warning: { wrap: "border-warning/40 bg-warning/10 text-foreground", icon: <TriangleAlert className="h-4 w-4 text-warning" /> },
  error: { wrap: "border-destructive/40 bg-destructive/10 text-foreground", icon: <AlertCircle className="h-4 w-4 text-destructive" /> },
};

export interface AlertProps {
  tone?: AlertTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function Alert({ tone = "info", title, children, className }: AlertProps) {
  const style = toneStyles[tone];
  return (
    <div className={cn("flex gap-3 rounded-md border p-3 text-sm", style.wrap, className)}>
      <div className="mt-0.5 shrink-0">{style.icon}</div>
      <div className="space-y-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}
