import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface BtnProps extends ButtonProps {
  loading?: boolean;
  icon?: React.ReactNode;
}

/** App-standard button: adds a loading spinner and a leading icon slot. */
export const Btn = React.forwardRef<HTMLButtonElement, BtnProps>(
  ({ loading, icon, children, disabled, className, ...props }, ref) => (
    <Button ref={ref} disabled={disabled || loading} className={cn(className)} {...props}>
      {loading ? <Loader2 className="animate-spin" /> : icon}
      {children}
    </Button>
  ),
);
Btn.displayName = "Btn";
