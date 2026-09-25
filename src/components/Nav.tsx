import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const LINKS = [
  ["/", "Today"],
  ["/calendar", "Calendar"],
  ["/history", "History"],
  ["/routines", "Routines"],
  ["/exercises", "Exercises"],
  ["/settings", "Settings"],
] as const;

// Rendered from the root layout; renders nothing on /login.
export async function Nav() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  return (
    <nav className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center gap-x-4 overflow-x-auto px-4 py-3 text-sm">
        <Link href="/" className="shrink-0 font-semibold">
          ProtoHybrid
        </Link>
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className="shrink-0 text-neutral-600 hover:text-neutral-900">
            {label}
          </Link>
        ))}
        <form action="/auth/signout" method="post" className="ml-auto shrink-0">
          <button className="text-neutral-400 hover:text-neutral-700">Sign out</button>
        </form>
      </div>
    </nav>
  );
}
