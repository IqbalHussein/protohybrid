import Link from "next/link";
import WeekGrid from "@/components/calendar/WeekGrid";
import { conflictWindow, findConflicts } from "@/lib/calendar/conflicts";
import { getLoggedSetCounts, getSessionsBetween, getWeek } from "@/lib/calendar/queries";
import { getConflictRules } from "@/lib/calendar/rules";
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

  const [data, rules] = await Promise.all([getWeek(weekStart), getConflictRules()]);

  const liftIds = data.sessions.filter((s) => s.type === "lift").map((s) => s.id);
  const reach = conflictWindow(weekStart, rules);
  const [setCounts, nearby] = await Promise.all([
    getLoggedSetCounts(liftIds),
    getSessionsBetween(reach.from, reach.to),
  ]);

  const conflicts = findConflicts(nearby, data.busyBlocks, rules);
  const view = buildWeekView(data, { setCounts, conflicts });
  const today = todayInZone();

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Week</h1>
        <span className="flex gap-3 text-sm text-neutral-500">
          <Link href="/settings" className="underline">
            Rules &amp; sync
          </Link>
          <Link href="/" className="underline">
            Home
          </Link>
        </span>
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

      {/* The week-level half of the conflict surface; the rules are edited in
          Settings. */}
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
