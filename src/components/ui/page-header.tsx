import type { ReactNode } from "react";

// Page title in Archivo wide; actions sit at the right on wide screens.
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="stretch-wide text-3xl font-extrabold leading-none tracking-tight sm:text-4xl">{title}</h1>
        {description && <p className="max-w-prose text-sm text-chalk-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// Section heading inside a page.
export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="stretch-semi text-lg font-bold">{children}</h2>
      {actions}
    </div>
  );
}
