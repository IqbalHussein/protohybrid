import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Labeled number. Use a row of these instead of "a · b · c" meta strings.
export function Stat({
  label,
  value,
  unit,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <span className="text-xs text-chalk-faint">{label}</span>
      <span className="stretch-semi text-base font-bold tabular-nums">
        {value}
        {unit && <span className="ml-0.5 text-xs font-medium text-chalk-muted">{unit}</span>}
      </span>
    </div>
  );
}
