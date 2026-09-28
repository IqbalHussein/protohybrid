"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { rescheduleSession } from "@/app/calendar/actions";
import { minuteAt, SNAP_MINUTES } from "@/lib/calendar/layout";
import type { PlacedSession, SessionView, WeekView } from "@/lib/calendar/week-view";
import { formatMinutes, formatTimeOfDay, minutesToTimeString } from "@/lib/time";

/**
 * The week grid (spec Screens #1), and the app's first client component.
 *
 * Everything else is server components and form actions with no client JS, and
 * this stays as close to that as dragging allows: the whole grid is rendered
 * from a view model the server computed, and a drop calls the same server
 * action the edit form's date and time fields call. Without JavaScript the
 * grid still renders and every card still links to an editor that can move it,
 * so drag is an enhancement rather than the only way through.
 */

/** Pixels of column height. Fixed, so an hour is the same height every week. */
const GRID_HEIGHT = 720;

type Props = {
  view: WeekView;
};

type DragState = { sessionId: string; title: string } | null;

export default function WeekGrid({ view }: Props) {
  const [dragging, setDragging] = useState<DragState>(null);
  const [hover, setHover] = useState<{ date: string; minute: number | null } | null>(null);
  const [pending, startTransition] = useTransition();

  const totalMinutes = view.window.endMin - view.window.startMin;

  function move(sessionId: string, date: string, minute: number | null) {
    const formData = new FormData();
    formData.set("sessionId", sessionId);
    formData.set("date", date);
    if (minute == null) formData.set("clearTime", "1");
    else formData.set("startTime", minutesToTimeString(minute));

    startTransition(async () => {
      await rescheduleSession(formData);
    });
  }

  function handleDropOnColumn(event: React.DragEvent<HTMLDivElement>, date: string) {
    event.preventDefault();
    const sessionId = event.dataTransfer.getData("text/session-id") || dragging?.sessionId;
    setDragging(null);
    setHover(null);
    if (!sessionId) return;

    const rect = event.currentTarget.getBoundingClientRect();
    move(sessionId, date, minuteAt((event.clientY - rect.top) / rect.height, view.window));
  }

  function handleDropOnUntimed(event: React.DragEvent<HTMLDivElement>, date: string) {
    event.preventDefault();
    const sessionId = event.dataTransfer.getData("text/session-id") || dragging?.sessionId;
    setDragging(null);
    setHover(null);
    if (sessionId) move(sessionId, date, null);
  }

  return (
    <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
      {/* Seven columns don't fit a phone; the grid scrolls sideways rather
          than shrinking each day into an unreadable sliver. */}
      <div className="overflow-x-auto">
        <div className="min-w-[46rem]">
          <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))]">
            <div />
            {view.days.map((day) => (
              <div
                key={day.date}
                className={`border-b px-1 pb-1 text-center text-xs ${
                  day.isToday ? "border-neutral-900 font-semibold" : "border-neutral-200 text-neutral-500"
                }`}
              >
                {day.heading}
                {day.isToday ? <span className="ml-1 text-neutral-400">today</span> : null}
              </div>
            ))}
          </div>

          {/* Untimed strip: "Saturday, sometime" is the default way to plan,
              so it gets a fixed home above the timed grid instead of being an
              edge case squeezed in at 12am. */}
          <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-b border-neutral-200">
            <div className="py-1 pr-1 text-right text-[10px] uppercase tracking-wide text-neutral-400">
              Any
            </div>
            {view.days.map((day) => (
              <div
                key={day.date}
                onDragOver={(e) => {
                  e.preventDefault();
                  setHover({ date: day.date, minute: null });
                }}
                onDragLeave={() => setHover(null)}
                onDrop={(e) => handleDropOnUntimed(e, day.date)}
                className={`flex min-h-[2.75rem] flex-col gap-1 border-l border-neutral-100 p-1 ${
                  hover?.date === day.date && hover.minute === null ? "bg-neutral-100" : ""
                }`}
              >
                {day.untimed.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    onDragStart={() => setDragging({ sessionId: session.id, title: session.title })}
                    onDragEnd={() => setDragging(null)}
                  />
                ))}
                <Link
                  href={`/calendar/session/new?date=${day.date}`}
                  className="rounded border border-dashed border-neutral-200 py-0.5 text-center text-[10px] text-neutral-400 hover:border-neutral-400 hover:text-neutral-700"
                >
                  +
                </Link>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))]">
            {/* Time gutter */}
            <div className="relative" style={{ height: GRID_HEIGHT }}>
              {view.hourMarks.map((minute) => (
                <span
                  key={minute}
                  className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-neutral-400"
                  style={{ top: `${((minute - view.window.startMin) / totalMinutes) * 100}%` }}
                >
                  {formatTimeOfDay(minute)}
                </span>
              ))}
            </div>

            {view.days.map((day) => (
              <div
                key={day.date}
                className={`relative border-l border-neutral-100 ${day.isToday ? "bg-amber-50/40" : ""}`}
                style={{ height: GRID_HEIGHT }}
                onDragOver={(e) => {
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHover({
                    date: day.date,
                    minute: minuteAt((e.clientY - rect.top) / rect.height, view.window),
                  });
                }}
                onDragLeave={() => setHover(null)}
                onDrop={(e) => handleDropOnColumn(e, day.date)}
              >
                {view.hourMarks.map((minute) => (
                  <div
                    key={minute}
                    className="absolute inset-x-0 border-t border-neutral-100"
                    style={{ top: `${((minute - view.window.startMin) / totalMinutes) * 100}%` }}
                  />
                ))}

                {/* Busy blocks sit behind the cards: they are the shape of the
                    day, not things to act on from here. */}
                {day.busy.map((block) => (
                  <Link
                    key={`${block.id}-${day.date}`}
                    href={`/calendar/busy/${block.id}?week=${view.weekStart}`}
                    className="absolute inset-x-0.5 overflow-hidden rounded-sm border border-neutral-200 bg-neutral-100/80 px-1 py-0.5 text-[10px] leading-tight text-neutral-500 hover:border-neutral-400"
                    style={{ top: `${block.topPct}%`, height: `${block.heightPct}%` }}
                    title={block.title}
                  >
                    <span className="line-clamp-2">{block.label}</span>
                  </Link>
                ))}

                {day.timed.map((session) => (
                  <TimedCard
                    key={session.id}
                    session={session}
                    onDragStart={() => setDragging({ sessionId: session.id, title: session.title })}
                    onDragEnd={() => setDragging(null)}
                  />
                ))}

                {/* Where the card would land, while a drag is in the air. */}
                {dragging && hover?.date === day.date && hover.minute != null ? (
                  <div
                    className="pointer-events-none absolute inset-x-0.5 rounded border border-dashed border-neutral-900 bg-white/70 px-1 text-[10px] text-neutral-700"
                    style={{
                      top: `${((hover.minute - view.window.startMin) / totalMinutes) * 100}%`,
                      height: `${(60 / totalMinutes) * 100}%`,
                    }}
                  >
                    {formatTimeOfDay(hover.minute)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-2 text-xs text-neutral-400">
        Drag a card to another day or time — drops snap to {SNAP_MINUTES} minutes. Dropping onto the
        &ldquo;Any&rdquo; row clears its time. Every card also opens an editor with date and time
        fields.
      </p>
    </div>
  );
}

function TimedCard({
  session,
  onDragStart,
  onDragEnd,
}: {
  session: PlacedSession;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const width = 100 / session.lanes;
  return (
    <div
      className="absolute px-0.5"
      style={{
        top: `${session.topPct}%`,
        height: `${session.heightPct}%`,
        left: `${session.lane * width}%`,
        width: `${width}%`,
      }}
    >
      <SessionCard session={session} onDragStart={onDragStart} onDragEnd={onDragEnd} fill />
    </div>
  );
}

const TYPE_STYLES: Record<string, string> = {
  run: "border-sky-300 bg-sky-50 text-sky-900",
  lift: "border-violet-300 bg-violet-50 text-violet-900",
};

function SessionCard({
  session,
  onDragStart,
  onDragEnd,
  fill = false,
}: {
  session: SessionView;
  onDragStart: () => void;
  onDragEnd: () => void;
  fill?: boolean;
}) {
  const done = session.status === "completed";
  const skipped = session.status === "skipped";

  return (
    <Link
      href={`/calendar/session/${session.id}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/session-id", session.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`block cursor-grab overflow-hidden rounded border px-1.5 py-1 text-[11px] leading-tight active:cursor-grabbing ${
        TYPE_STYLES[session.type]
      } ${fill ? "h-full" : ""} ${skipped ? "opacity-50 line-through decoration-1" : ""} ${
        session.assumedDuration ? "border-dashed" : ""
      }`}
    >
      <span className="flex items-baseline gap-1">
        <span className="truncate font-medium capitalize">{session.title}</span>
        {done ? <span aria-label="completed">✓</span> : null}
        {session.unresolved ? (
          <span className="text-amber-700" title="This day has passed and it was never resolved">
            !
          </span>
        ) : null}
      </span>

      {session.startMin != null ? (
        <span className="block truncate tabular-nums opacity-70">
          {formatTimeOfDay(session.startMin)}
          {session.durationMin ? ` · ${formatMinutes(session.durationMin)}` : ""}
        </span>
      ) : null}

      {session.subtitle ? <span className="block truncate opacity-70">{session.subtitle}</span> : null}

      {/* The card half of the conflict surface (see src/lib/calendar/conflicts.ts). */}
      {session.conflicts.map((message) => (
        <span key={message} className="mt-0.5 block truncate rounded bg-amber-100 px-1 text-amber-900">
          {message}
        </span>
      ))}
    </Link>
  );
}
