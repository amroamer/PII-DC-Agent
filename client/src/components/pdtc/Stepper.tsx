import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepDef {
  key: string;
  label: string;
}

export function Stepper({
  steps,
  current,
  onStepClick,
  unlocked,
}: {
  steps: StepDef[];
  current: number;
  onStepClick?: (index: number) => void;
  unlocked: number;
}) {
  return (
    <ol className="flex items-center gap-2">
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const clickable = i <= unlocked && onStepClick;
        return (
          <li key={step.key} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onStepClick?.(i)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 text-sm",
                clickable && "hover:bg-accent",
                !clickable && "cursor-default",
              )}
            >
              <span
                className={cn(
                  "grid h-6 w-6 place-items-center rounded-full border text-xs",
                  active && "border-primary bg-primary text-primary-foreground",
                  done && "border-success bg-success text-success-foreground",
                  !active && !done && "border-border text-muted-foreground",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn("font-medium", active ? "text-foreground" : "text-muted-foreground")}>{step.label}</span>
            </button>
            {i < steps.length - 1 && <div className="h-px flex-1 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}
