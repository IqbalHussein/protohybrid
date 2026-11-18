"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { addDays, formatDayMonth, weekDays, weekdayShort } from "@/lib/time";
import { sessionToneClasses } from "@/components/ui/session-tone";
import type { PlanSessionView, PlanWeekView } from "./data";
import { DayDetail } from "./day-detail";
import { INTENSITY_LABEL, WEEK_KIND_LABEL, bySlot, chipText, slotLabel } from "./labels";

function SessionChip({ s }: { s: PlanSessionView }) {
  const slot = slotLabel(s.slot);
  const status = s.status === "preview" ? "planned" : s.status;
  return (
    <span
      className={cn(
        "flex flex-col gap-0.5 rounded-control px-2 py-1.5 text-xs font-semibold leading-snug [overflow-wrap:anywhere]",
        sessionToneClasses(s.type, status),
      )}
    >
      <span>
        {slot && <span className="mr-1 opacity-70">{slot}</span>}
        {chipText(s)}
      </span>
      <span className="font-medium opacity-80">
        {INTENSITY_LABEL[s.intensity]}
        {s.status === "completed" && " · Done"}
        {s.status === "skipped" && " · Skipped"}
      </span>
    </span>
  );
}

// Week switcher, the week at a glance (rows on phones, seven columns from
// md up) and an inline day detail. The same component renders the preview and
// the active plan; `active` turns on status and session actions.
export function PlanView({
  weeks,
  sessions,
  today,
  active,
}: {
  weeks: PlanWeekView[];
  sessions: PlanSessionView[];
  today: string;
  active: boolean;
}) {
  const initialWeek = (weeks.find((w) => today >= w.startDate && today <= addDays(w.startDate, 6)) ?? weeks[0])?.index ?? 1;
  const [weekIndex, setWeekIndex] = useState(initialWeek);
  const [openDate, setOpenDate] = useState<string | null>(null);

  const week = weeks.find((w) => w.index === weekIndex) ?? weeks[0];
  if (!week) return null;

  const dates = weekDays(week.startDate);
  const inPlan = new Set(weeks.flatMap((w) => weekDays(w.startDate)));
  const outside = sessions.filter((s) => !inPlan.has(s.date)).length;

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Week" className="grid grid-cols-4 gap-2">
        {weeks.map((w) => {
          const on = w.index === week.index;
          return (
            <button
              key={w.index}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setWeekIndex(w.index);
                setOpenDate(null);
              }}
              className={cn(
                "flex min-h-11 flex-col items-start gap-0.5 rounded-control border px-2.5 py-2 text-left transition-colors sm:px-3",
                on ? "border-chalk bg-chalk text-ink" : "border-ink-line-strong text-chalk hover:bg-ink-raised",
              )}
            >
              <span className="stretch-semi text-sm font-bold">
                W{w.index} <span className="text-xs font-semibold">{WEEK_KIND_LABEL[w.kind]}</span>
              </span>
              <span className={cn("text-xs tabular-nums", on ? "text-ink" : "text-chalk-muted")}>Run {w.runMin}m</span>
              <span className={cn("text-xs tabular-nums", on ? "text-ink" : "text-chalk-muted")}>Lift {w.liftMin}m</span>
            </button>
          );
        })}
      </div>

      <ol className="grid gap-2 md:grid-cols-7" aria-label={`Week ${week.index} days`}>
        {dates.map((date) => {
          const day = sessions.filter((s) => s.date === date).sort(bySlot);
          const isToday = date === today;
          const open = openDate === date;
          const detailId = `day-${date}`;
          const label = (
            <span className="flex w-16 shrink-0 flex-col md:w-auto">
              <span className="text-sm font-bold">{weekdayShort(date)}</span>
              <span className="text-xs text-chalk-muted">{formatDayMonth(date)}</span>
              {isToday && <span className="text-xs font-semibold text-chalk">Today</span>}
            </span>
          );
          const cls = cn(
            "flex min-h-11 w-full items-start gap-3 rounded-panel border bg-ink-raised p-3 text-left md:flex-col md:gap-2",
            isToday ? "border-chalk-muted" : "border-ink-line",
          );
          return (
            <li key={date} className="contents">
              {day.length === 0 ? (
                <div className={cn(cls, "items-center md:items-start")}>
                  {label}
                  <span className="text-sm text-chalk-faint">Rest</span>
                </div>
              ) : (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={open ? detailId : undefined}
                  onClick={() => setOpenDate(open ? null : date)}
                  className={cn(cls, "hover:border-ink-line-strong", open && "border-chalk-muted")}
                >
                  {label}
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5 md:w-full md:flex-none">
                    {day.map((s) => (
                      <SessionChip key={s.id ?? s.key} s={s} />
                    ))}
                  </span>
                </button>
              )}
              {open && day.length > 0 && <DayDetail id={detailId} sessions={day} active={active} allSessions={sessions} />}
            </li>
          );
        })}
      </ol>

      {outside > 0 && (
        <p className="text-xs text-chalk-faint">
          {outside} {outside === 1 ? "session was" : "sessions were"} moved outside these weeks. See the Week page.
        </p>
      )}
    </div>
  );
}
