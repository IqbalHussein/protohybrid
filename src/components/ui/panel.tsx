import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// Raised surface for grouping. Hairline border, no shadow.
export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-panel border border-ink-line bg-ink-raised p-4 sm:p-5", className)} {...props} />;
}
