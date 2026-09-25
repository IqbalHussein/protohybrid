import Link from "next/link";
import { getActiveWorkout, getRoutines } from "@/lib/lift/queries";
import { getSessionsBetween, getWeek, sessionLabel } from "@/lib/calendar";
import { getSettings } from "@/lib/settings";
import { addDays, formatDate, mondayOf, todayIn } from "@/lib/dates";
import { plannedSummary, runActualSummary } from "@/lib/summaries";
import { startPlannedWorkout, startWorkout } from "./workout/actions";

export default async function Home() {
  const { timezone } = await getSettings();
  const today = todayIn(timezone);
  const [active, routines, todays, week, recent] = await Promise.all([
    getActiveWorkout(),
    getRoutines(),
    getSessionsBetween(today, addDays(today, 1)),
    getWeek(mondayOf(today)),
    getSessionsBetween(addDays(today, -14), today),
  ]);
  const completed = recent.filter((s) => s.status === "completed").reverse().slice(0, 5);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold">{formatDate(today, { weekday: "long", month: "long" })}</h1>
      </header>

      {week.conflicts.length ? (
        <Link href="/calendar" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          ⚠ {week.conflicts.length} scheduling conflict{week.conflicts.length > 1 ? "s" : ""} this week — review on the calendar
        </Link>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Today &amp; tomorrow</h2>
        {todays.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Nothing planned. <Link href={`/sessions/new?date=${today}`} className="underline">Plan a session</Link> or start a workout below.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {todays.map((s) => {
              const startable =
                s.type === "lift" && s.status === "planned" && !s.lift_details?.started_at && s.planned_date === today;
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 rounded border border-neutral-200 px-4 py-3">
                  <Link href={`/sessions/${s.id}`} className="min-w-0 flex-1">
                    <p className="font-medium">
                      {sessionLabel(s)}
                      {s.status === "completed" ? " ✓" : s.status === "skipped" ? " (skipped)" : ""}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {s.planned_date === today ? "Today" : "Tomorrow"}
                      {s.planned_time ? ` · ${s.planned_time.slice(0, 5)}` : ""}
                      {(s.type === "run" ? runActualSummary(s) : null) ?? plannedSummary(s)
                        ? ` · ${(s.type === "run" ? runActualSummary(s) : null) ?? plannedSummary(s)}`
                        : ""}
                    </p>
                  </Link>
                  {startable ? (
                    <form action={startPlannedWorkout}>
                      <input type="hidden" name="sessionId" value={s.id} />
                      <button className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">Start</button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Lift now</h2>
        {active ? (
          <Link href={`/workout/${active.id}`} className="rounded bg-neutral-900 px-4 py-3 text-center text-white">
            Resume workout in progress
          </Link>
        ) : (
          <form action={startWorkout} className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <input
                name="focus"
                placeholder="Focus: push / pull / legs…"
                className="min-w-40 flex-1 rounded border border-neutral-300 px-3 py-2 text-base"
              />
              {routines.length ? (
                <select name="routineId" defaultValue="" className="rounded border border-neutral-300 px-2 py-2 text-base">
                  <option value="">Blank workout</option>
                  {routines.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            <button className="rounded bg-neutral-900 px-4 py-3 text-white">Start ad-hoc workout</button>
          </form>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Recent</h2>
          <Link href="/history" className="text-sm text-neutral-500 underline">
            All history
          </Link>
        </div>
        {completed.length === 0 ? (
          <p className="text-sm text-neutral-500">No completed sessions in the last two weeks.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {completed.map((s) => (
              <li key={s.id}>
                <Link
                  href={s.type === "lift" ? `/workout/${s.id}/summary` : `/sessions/${s.id}`}
                  className="flex items-baseline justify-between rounded border border-neutral-200 px-4 py-3"
                >
                  <span className="font-medium">{sessionLabel(s)}</span>
                  <span className="text-sm text-neutral-500">{formatDate(s.planned_date)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
