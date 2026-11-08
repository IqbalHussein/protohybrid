import type { ReactNode } from "react";

// An empty list is an invitation to act: say what goes here and offer the action.
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-panel border border-dashed border-ink-line px-5 py-6 text-sm text-chalk-muted">
      <p>{children}</p>
      {action}
    </div>
  );
}
