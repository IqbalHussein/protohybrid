import { cn } from "@/lib/cn";
import { DEFAULT_DURATION_MIN, type Conflict } from "@/lib/conflicts";
import { formatDateLabel, weekdayShort } from "@/lib/time";
import type { CardSession } from "./data";

const BAR_HEIGHT_PX = 112;

function minutes(s: CardSession): number {
  return s.durationMin ?? DEFAULT_DURATION_MIN;
}

function describe(date: string, sessions: CardSession[], conflicts: number): string {
  const c = conflicts ? `, ${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}` : "";
  if (sessions.length === 0) return `${formatDateLabel(date)}: rest${c}.`;
  const parts = sessions.map(
    (s) => `${minutes(s)} minute ${s.type} ${s.status === "completed" ? "done" : "planned"}`,
  );
  return `${formatDateLabel(date)}: ${parts.join(", ")}${c}.`;
}

// The week's training load at a glance: one stacked bar per day, runs in blue
// over lifts in orange. Planned is outlined, done is solid, skipped is left out.
export function LoadStrip({
  days,
  sessions,
  conflictsByDate,
}: {
  days: { date: string; isToday: boolean }[];
  sessions: CardSession[];
  conflictsByDate: Map<string, Conflict[]>;
}) {
  const active = sessions.filter((s) => s.status !== "skipped");
  const totals = days.map((d) => active.filter((s) => s.date === d.date).reduce((sum, s) => sum + minutes(s), 0));
  const scale = Math.max(120, ...totals);
  const weekTotal = totals.reduce((a, b) => a + b, 0);
  const runMin = active.filter((s) => s.type === "run").reduce((sum, s) => sum + minutes(s), 0);

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="stretch-wide text-2xl font-extrabold tabular-nums">
          {Math.round((weekTotal / 60) * 10) / 10}
          <span className="ml-1 text-sm font-semibold text-chalk-muted">hours this week</span>
        </span>
        <span className="text-sm text-chalk-muted">
          <span className="font-semibold text-run">{runMin} min running</span>
          <span aria-hidden className="mx-2 text-chalk-faint">/</span>
          <span className="font-semibold text-lift">{weekTotal - runMin} min lifting</span>
        </span>
      </figcaption>

      <ol className="grid grid-cols-7 gap-1.5 sm:gap-3">
        {days.map((day, i) => {
          const daySessions = active
            .filter((s) => s.date === day.date)
            .sort((a, b) => (a.type === b.type ? 0 : a.type === "run" ? -1 : 1));
          const conflicts = conflictsByDate.get(day.date)?.length ?? 0;
          return (
            <li key={day.date} className="flex flex-col gap-1.5">
              <span className="sr-only">{describe(day.date, daySessions, conflicts)}</span>
              <div aria-hidden className="relative flex flex-col justify-end gap-0.5" style={{ height: BAR_HEIGHT_PX }}>
                {conflicts > 0 && (
                  <span className="absolute inset-x-0 top-0 mx-auto flex h-5 w-5 items-center justify-center rounded-full bg-chalk text-xs font-extrabold text-ink">
                    !
                  </span>
                )}
                {daySessions.length === 0 && <div className="h-1 rounded-sm bg-ink-line" />}
                {daySessions.map((s) => (
                  <div
                    key={s.id}
                    className={cn(
                      "rounded-sm",
                      s.status === "completed"
                        ? s.type === "run"
                          ? "bg-run"
                          : "bg-lift"
                        : s.type === "run"
                          ? "border-2 border-run"
                          : "border-2 border-lift",
                    )}
                    style={{ height: Math.max(6, (minutes(s) / scale) * (BAR_HEIGHT_PX - 24)) }}
                  />
                ))}
              </div>
              <span
                aria-hidden
                className={cn(
                  "text-center text-xs font-semibold",
                  day.isToday ? "text-chalk" : "text-chalk-faint",
                )}
              >
                {weekdayShort(day.date)}
                <span className="block tabular-nums">{totals[i] > 0 ? totals[i] : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
