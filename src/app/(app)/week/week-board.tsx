"use client";

import { useOptimistic, useState, useTransition, type DragEvent } from "react";
import { cn } from "@/lib/cn";
import { formatTime, isoWeekday, weekdayShort } from "@/lib/time";
import { Dialog } from "@/components/ui/dialog";
import { moveSession } from "./actions";
import type { CardSession, DayBusy } from "./data";
import { PlanSessionForm } from "./plan-session-form";
import { SessionCard } from "./session-card";

export type BoardDay = {
  date: string;
  isToday: boolean;
  busy: DayBusy[];
};

const DRAG_TYPE = "application/x-protohybrid-session";

function busyTime(b: DayBusy): string {
  if (b.startMin === 0 && b.endMin >= 1440) return "All day";
  return `${formatTime(b.startMin)}–${b.endMin >= 1440 ? "24:00" : formatTime(b.endMin)}`;
}

export function WeekBoard({
  days,
  sessions,
  routines,
}: {
  days: BoardDay[];
  sessions: CardSession[];
  routines: { id: string; name: string }[];
}) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overDate, setOverDate] = useState<string | null>(null);
  const [optimistic, moveOptimistic] = useOptimistic(sessions, (current, move: { id: string; date: string }) =>
    current.map((s) => (s.id === move.id ? { ...s, date: move.date } : s)),
  );

  function onDragStart(e: DragEvent, session: CardSession) {
    e.dataTransfer.setData(DRAG_TYPE, session.id);
    e.dataTransfer.effectAllowed = "move";
    setDragging(session.id);
    setError(null);
  }

  function onDrop(e: DragEvent, date: string) {
    e.preventDefault();
    setOverDate(null);
    setDragging(null);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const session = optimistic.find((s) => s.id === id);
    if (!session || session.date === date) return;
    startTransition(async () => {
      moveOptimistic({ id, date });
      const result = await moveSession(id, date, session.startTime);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p role="status" aria-live="polite" className={cn("text-sm", error ? "text-danger" : "sr-only")}>
        {error ?? ""}
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
        {days.map((day) => {
          const daySessions = optimistic.filter((s) => s.date === day.date);
          const dayNumber = Number(day.date.slice(8, 10));
          const weekend = isoWeekday(day.date) >= 6;
          return (
            <section
              key={day.date}
              aria-label={`${weekdayShort(day.date)} ${dayNumber}`}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overDate !== day.date) setOverDate(day.date);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverDate(null);
              }}
              onDrop={(e) => onDrop(e, day.date)}
              className={cn(
                "flex min-h-40 flex-col gap-3 rounded-panel border p-3 transition-colors",
                day.isToday ? "border-chalk-muted" : "border-ink-line",
                overDate === day.date ? "border-chalk bg-ink-raised" : "",
              )}
            >
              <header className="flex items-end justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "stretch-wide text-3xl font-extrabold leading-none tabular-nums",
                      day.isToday ? "text-chalk" : weekend ? "text-chalk-muted" : "text-chalk",
                    )}
                  >
                    {dayNumber}
                  </span>
                  <span className="text-sm font-semibold text-chalk-muted">
                    {weekdayShort(day.date)}
                    {day.isToday && <span className="ml-1 text-chalk">today</span>}
                  </span>
                </div>
                <Dialog
                  trigger="Plan"
                  triggerVariant="ghost"
                  triggerSize="sm"
                  triggerAriaLabel={`Plan a session on ${weekdayShort(day.date)} ${dayNumber}`}
                  title="Plan a session"
                >
                  <PlanSessionForm date={day.date} routines={routines} />
                </Dialog>
              </header>

              {day.busy.length > 0 && (
                <ul className="flex flex-col gap-1.5" aria-label="Busy">
                  {day.busy.map((b) => (
                    <li
                      key={`${b.id}-${b.startMin}`}
                      className="flex flex-col rounded-control border border-dashed border-ink-line-strong px-2 py-1 text-xs text-chalk-muted"
                    >
                      <span className="font-semibold tabular-nums">{busyTime(b)}</span>
                      <span className="line-clamp-2">{b.title}</span>
                    </li>
                  ))}
                </ul>
              )}

              {daySessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  onDragStart={onDragStart}
                  onDragEnd={() => {
                    setDragging(null);
                    setOverDate(null);
                  }}
                />
              ))}

              {daySessions.length === 0 && (
                <p className="text-xs text-chalk-faint">Rest day</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
