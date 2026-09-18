import Link from "next/link";
import WeekGrid from "@/components/calendar/WeekGrid";
import { getLoggedSetCounts, getWeek } from "@/lib/calendar/queries";
import { buildWeekView } from "@/lib/calendar/week-view";
import { addWeeks, currentWeekStart, formatWeekRange, mondayOf } from "@/lib/week";
import { todayInZone } from "@/lib/time";

/**
 * The week grid (spec Screens #1) — the screen the rest of the MVP hangs off.
 *
 * Read-only: browsing forward through empty weeks must leave no `plans` rows
 * behind, so nothing here writes. `plans` is created lazily on the first write
 * into a week, the way the logger already does it.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;

  // Any date in the URL resolves to its Monday, so a hand-edited or stale link
  // lands on a real week rather than a seven-day window starting mid-week.
  const weekStart = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? mondayOf(week) : currentWeekStart();

  const data = await getWeek(weekStart);

  const liftIds = data.sessions.filter((s) => s.type === "lift").map((s) => s.id);
  const setCounts = await getLoggedSetCounts(liftIds);

  const view = buildWeekView(data, { setCounts });
  const today = todayInZone();

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Week</h1>
        <Link href="/" className="text-sm text-neutral-500 underline">
          Home
        </Link>
      </header>

      <nav className="flex flex-wrap items-center gap-2">
        <Link
          href={`/calendar?week=${addWeeks(weekStart, -1)}`}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
          rel="prev"
        >
          ← Previous
        </Link>
        <span className="min-w-44 text-center text-sm font-medium tabular-nums">
          {formatWeekRange(weekStart)}
        </span>
        <Link
          href={`/calendar?week=${addWeeks(weekStart, 1)}`}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
          rel="next"
        >
          Next →
        </Link>
        {weekStart === currentWeekStart() ? null : (
          <Link href="/calendar" className="text-sm text-neutral-500 underline">
            This week
          </Link>
        )}

        <span className="ml-auto flex gap-2">
          <Link
            href={`/calendar/session/new?date=${today}&type=run`}
            className="rounded border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm text-sky-900"
          >
            + Run
          </Link>
          <Link
            href={`/calendar/session/new?date=${today}&type=lift`}
            className="rounded border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm text-violet-900"
          >
            + Lift
          </Link>
          <Link
            href={`/calendar/busy/new?date=${today}&week=${weekStart}`}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
          >
            + Commitment
          </Link>
        </span>
      </nav>

      {/* The week-level half of the conflict surface. Empty until the rule
          engine lands (MVP #5); the spec reserves the spot, not the rules. */}
      {view.warnings.length ? (
        <ul className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {view.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <WeekGrid view={view} />

      {data.sessions.length === 0 && data.busyBlocks.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Nothing planned this week. Add a run or a lift above, or drop in the classes and shifts
          you have to train around.
        </p>
      ) : null}
    </main>
  );
}
