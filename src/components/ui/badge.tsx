import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "run" | "lift" | "conflict" | "pr" | "neutral";

const tones: Record<BadgeTone, string> = {
  run: "bg-run-soft text-run-strong",
  lift: "bg-lift-soft text-lift-strong",
  // Conflicts are inverted chalk so they never read as a lift.
  conflict: "bg-chalk text-ink",
  pr: "border border-lift text-lift-strong",
  neutral: "bg-ink-raised text-chalk-muted",
};

export function Badge({ tone = "neutral", className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", tones[tone], className)}>
      {children}
    </span>
  );
}
