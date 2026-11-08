"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/week", label: "Week" },
  { href: "/lifts", label: "Lifts" },
  { href: "/runs", label: "Runs" },
  { href: "/settings", label: "Settings" },
] as const;

function useActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

export function RailNav() {
  const isActive = useActive();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={isActive(l.href) ? "page" : undefined}
          className={cn(
            "rounded-control px-3 py-2 text-sm font-semibold transition-colors",
            isActive(l.href) ? "bg-ink-raised text-chalk" : "text-chalk-muted hover:text-chalk",
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function TabNav() {
  const isActive = useActive();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-ink-line bg-ink pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={isActive(l.href) ? "page" : undefined}
          className={cn(
            "flex h-14 items-center justify-center text-sm font-semibold",
            isActive(l.href) ? "text-chalk" : "text-chalk-faint",
          )}
        >
          <span className={cn("border-b-2 pb-0.5", isActive(l.href) ? "border-chalk" : "border-transparent")}>
            {l.label}
          </span>
        </Link>
      ))}
    </nav>
  );
}
