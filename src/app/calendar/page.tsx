import Link from "next/link";
import { getWeek } from "@/lib/calendar";
import { addDays, formatDate, formatTimeIn, isDateString, mondayOf, todayIn, weekDates, zonedToUtc } from "@/lib/dates";
import { formatKm } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { liftActualSummary, plannedSummary, runActualSummary } from "@/lib/summaries";
import { WeekBoard, type BoardDay } from "@/components/WeekBoard";
import { addBusyBlock } from "../sessions/actions";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const { timezone } = await getSettings();
  const today = todayIn(timezone);
  const monday = mondayOf(week && isDateString(week) ? week : today);
  const { sessions, busy, conflicts, liftActuals, tz } = await getWeek(monday);

  const conflictsBySession = new Map<string, string[]>();
  for (const c of conflicts) {
    for (const id of c.sessionIds) conflictsBySession.set(id, [...(conflictsBySession.get(id) ?? []), c.message]);
  }

  const days: BoardDay[] = weekDates(monday).map((date) => {
    const dayStart = zonedToUtc(date, "00:00", tz).getTime();
    const dayEnd = zonedToUtc(addDays(date, 1), "00:00", tz).getTime();
    return {
      date,
      weekday: formatDate(date, { weekday: "short", month: undefined, day: undefined }),
      dayLabel: formatDate(date, { weekday: undefined }),
      isToday: date === today,
      cards: sessions
        .filter((s) => s.planned_date === date)
        .map((s) => ({
          id: s.id,
          type: s.type,
          time: s.planned_time?.slice(0, 5) ?? null,
          status: s.status,
          adHoc: s.ad_hoc,
          label: s.type === "run" ? `${s.run_details?.run_type ?? ""} run` : s.lift_details?.focus ?? "Lift",
          planned: plannedSummary(s),
          actual: s.type === "run" ? runActualSummary(s) : liftActualSummary(liftActuals.get(s.id)),
          conflicts: conflictsBySession.get(s.id) ?? [],
        })),
      busy: busy
        .filter((b) => new Date(b.start_time).getTime() < dayEnd && new Date(b.end_time).getTime() > dayStart)
        .map((b) => ({
          id: b.id,
          title: b.title,
          range: `${formatTimeIn(b.start_time, tz)}–${formatTimeIn(b.end_time, tz)}`,
          manual: b.source === "manual",
        })),
    };
  });

  const runs = sessions.filter((s) => s.type === "run");
  const lifts = sessions.filter((s) => s.type === "lift");
  const plannedKm = runs.reduce((sum, s) => sum + Number(s.run_details?.target_distance_km ?? 0), 0);
  const actualKm = runs.reduce((sum, s) => sum + Number(s.run_details?.actual_distance_km ?? 0), 0);
  const liftVolume = [...liftActuals.values()].reduce((sum, a) => sum + a.volume, 0);
  const done = (xs: typeof sessions) => xs.filter((s) => s.status === "completed").length;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">
          Week of {formatDate(monday, { weekday: undefined, year: "numeric" })}
        </h1>
        <div className="flex gap-3 text-sm">
          <Link href={`/calendar?week=${addDays(monday, -7)}`} className="underline">
            ← Prev
          </Link>
          <Link href="/calendar" className="underline">
            This week
          </Link>
          <Link href={`/calendar?week=${addDays(monday, 7)}`} className="underline">
            Next →
          </Link>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {[
          ["Runs done / planned", `${done(runs)} / ${runs.length}`],
          ["Distance actual / planned", `${formatKm(actualKm)} / ${formatKm(plannedKm)}`],
          ["Lifts done / planned", `${done(lifts)} / ${lifts.length}`],
          ["Lift volume", `${liftVolume.toLocaleString()} lb`],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-neutral-200 px-3 py-2">
            <dt className="text-xs text-neutral-500">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      {conflicts.length ? (
        <section className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm">
          <h2 className="font-medium text-red-800">
            {conflicts.length} conflict{conflicts.length > 1 ? "s" : ""} this week
          </h2>
          <ul className="mt-1 list-disc pl-5 text-red-700">
            {conflicts.map((c) => (
              <li key={c.key}>
                <span className="font-medium">{c.ruleName}:</span> {c.message}
              </li>
            ))}
          </ul>
          <Link href="/settings#rules" className="mt-1 inline-block text-xs text-red-700 underline">
            Adjust rules
          </Link>
        </section>
      ) : null}

      <WeekBoard days={days} />

      <div className="grid gap-4 md:grid-cols-2">
        <Link href={`/sessions/new?date=${monday < today && today <= addDays(monday, 6) ? today : monday}`} className="rounded bg-neutral-900 px-4 py-3 text-center text-white">
          Plan a session
        </Link>
        <details className="rounded border border-neutral-200 p-3 text-sm">
          <summary className="cursor-pointer font-medium">Add a busy block</summary>
          <form action={addBusyBlock} className="mt-2 flex flex-wrap items-end gap-2">
            <input name="title" placeholder="Class, shift…" className="flex-1 rounded border border-neutral-300 px-2 py-1.5" />
            <input name="date" type="date" required defaultValue={monday} className="rounded border border-neutral-300 px-2 py-1.5" />
            <input name="start" type="time" required className="rounded border border-neutral-300 px-2 py-1.5" />
            <input name="end" type="time" required className="rounded border border-neutral-300 px-2 py-1.5" />
            <button className="rounded border border-neutral-300 px-3 py-1.5">Add</button>
          </form>
          <p className="mt-2 text-xs text-neutral-500">
            Or <Link href="/settings#integrations" className="underline">connect Google Calendar</Link> to pull them in automatically.
          </p>
        </details>
      </div>
      <p className="text-xs text-neutral-400">Drag sessions between days to reschedule. Times shown in {tz}.</p>
    </main>
  );
}
