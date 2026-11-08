import Link from "next/link";
import { RailNav, TabNav } from "@/components/nav";
import { Wordmark } from "@/components/wordmark";

// Signed-in app chrome: left rail on desktop, bottom tabs on mobile.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lg:grid lg:min-h-screen lg:grid-cols-[13rem_1fr]">
      <aside className="hidden border-r border-ink-line px-4 py-6 lg:flex lg:flex-col lg:gap-8">
        <Link href="/week" className="px-3">
          <Wordmark />
        </Link>
        <RailNav />
      </aside>
      <header className="flex h-14 items-center border-b border-ink-line px-4 lg:hidden">
        <Link href="/week">
          <Wordmark />
        </Link>
      </header>
      <main className="min-w-0 px-4 pb-24 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">{children}</main>
      <TabNav />
    </div>
  );
}
