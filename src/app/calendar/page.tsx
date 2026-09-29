import Link from "next/link";
import WeekGrid from "@/components/calendar/WeekGrid";
import { conflictWindow, findConflicts } from "@/lib/calendar/conflicts";
import { describeLoad, weekLoad } from "@/lib/calendar/load";
import { getLoadSets, getLoggedSetCounts, getSessionsBetween, getWeek } from "@/lib/calendar/queries";
import { getConflictRules } from "@/lib/calendar/rules";
import { buildWeekView } from "@/lib/calendar/week-view";
import { addDays, addWeeks, currentWeekStart, formatWeekRange, mondayOf } from "@/lib/week";
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

  const previousWeekStart = addWeeks(weekStart, -1);
  const [data, previous, rules] = await Promise.all([
    getWeek(weekStart),
    getWeek(previousWeekStart),
    getConflictRules(),
  ]);

  const liftIds = (week: typeof data) => week.sessions.filter((s) => s.type === "lift").map((s) => s.id);
  const reach = conflictWindow(weekStart, rules);
  const [setCounts, nearby, loadSets, previousLoadSets] = await Promise.all([
    getLoggedSetCounts(liftIds(data)),
    getSessionsBetween(reach.from, reach.to),
    getLoadSets(liftIds(data)),
    getLoadSets(liftIds(previous)),
  ]);

  const conflicts = findConflicts(nearby, data.busyBlocks, rules);
  const view = buildWeekView(data, { setCounts, conflicts });
  const today = todayInZone();

  // A week in progress is compared with the same stretch of last week, so a
  // Tuesday doesn't read as a 70% drop against a finished week.
  const isCurrentWeek = weekStart === currentWeekStart();
  const load = describeLoad(
    weekLoad(data.sessions, loadSets),
    weekLoad(previous.sessions, previousLoadSets, isCurrentWeek ? addDays(today, -7) : undefined),
  );

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

      <section aria-label="Training load" className="grid gap-2 sm:grid-cols-3">
        {load.map((item) => (
          <div key={item.label} className="rounded border border-neutral-200 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-neutral-400">{item.label}</p>
            <p className="font-medium tabular-nums">
              {item.value}
              {item.change != null ? (
                <span
                  className={`ml-2 text-xs ${item.change > 0 ? "text-amber-700" : "text-neutral-500"}`}
                  title={isCurrentWeek ? "vs the same days last week" : "vs last week"}
                >
                  {item.change > 0 ? "+" : ""}
                  {item.change}%
                </span>
              ) : null}
            </p>
            {item.detail ? <p className="text-xs text-neutral-500 tabular-nums">{item.detail}</p> : null}
          </div>
        ))}
      </section>

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
