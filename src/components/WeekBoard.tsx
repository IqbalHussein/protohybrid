"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { deleteBusyBlock, moveSession } from "@/app/sessions/actions";

export type BoardCard = {
  id: string;
  type: "run" | "lift";
  time: string | null;
  status: "planned" | "completed" | "skipped";
  adHoc: boolean;
  label: string;
  planned: string | null;
  actual: string | null;
  conflicts: string[];
};

export type BoardBusy = { id: string; title: string; range: string; manual: boolean };

export type BoardDay = {
  date: string;
  weekday: string;
  dayLabel: string;
  isToday: boolean;
  cards: BoardCard[];
  busy: BoardBusy[];
};

const STATUS_STYLE: Record<BoardCard["status"], string> = {
  planned: "",
  completed: "opacity-90",
  skipped: "opacity-50 line-through",
};

// The week grid. Sessions drag between days to reschedule (desktop); on touch
// devices the session page's date field does the same job.
export function WeekBoard({ days }: { days: BoardDay[] }) {
  const [, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [optimistic, move] = useOptimistic(days, (state, { id, date }: { id: string; date: string }) => {
    const card = state.flatMap((d) => d.cards).find((c) => c.id === id);
    if (!card) return state;
    return state.map((d) => ({
      ...d,
      cards:
        d.date === date
          ? [...d.cards.filter((c) => c.id !== id), card].sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""))
          : d.cards.filter((c) => c.id !== id),
    }));
  });

  function onDrop(date: string, e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/session-id");
    if (!id) return;
    setError(null);
    startTransition(async () => {
      move({ id, date });
      try {
        await moveSession(id, date);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not move session");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
        {optimistic.map((day) => (
          <section
            key={day.date}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(day.date);
            }}
            onDragLeave={() => setDragOver((d) => (d === day.date ? null : d))}
            onDrop={(e) => onDrop(day.date, e)}
            className={`flex min-h-28 flex-col gap-1.5 rounded border p-2 ${
              dragOver === day.date ? "border-neutral-900 bg-neutral-50" : day.isToday ? "border-neutral-400" : "border-neutral-200"
            }`}
          >
            <header className="flex items-baseline justify-between">
              <span className={`text-xs font-medium uppercase tracking-wide ${day.isToday ? "text-neutral-900" : "text-neutral-500"}`}>
                {day.weekday}
              </span>
              <span className="text-xs text-neutral-400">{day.dayLabel}</span>
            </header>

            {day.busy.map((b) => (
              <div key={b.id} className="flex items-start justify-between gap-1 rounded bg-neutral-100 px-1.5 py-1 text-xs text-neutral-600">
                <span className="min-w-0">
                  <span className="block truncate">{b.title}</span>
                  <span className="text-neutral-400">{b.range}</span>
                </span>
                {b.manual ? (
                  <form action={deleteBusyBlock}>
                    <input type="hidden" name="id" value={b.id} />
                    <button aria-label="Delete busy block" className="text-neutral-400 hover:text-red-600">
                      ×
                    </button>
                  </form>
                ) : null}
              </div>
            ))}

            {day.cards.map((c) => (
              <Link
                key={c.id}
                href={`/sessions/${c.id}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/session-id", c.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                className={`block cursor-grab rounded border px-2 py-1.5 text-xs ${
                  c.type === "run" ? "border-sky-200 bg-sky-50" : "border-amber-200 bg-amber-50"
                } ${c.conflicts.length ? "ring-2 ring-red-400" : ""} ${STATUS_STYLE[c.status]}`}
                title={c.conflicts.join("\n") || undefined}
              >
                <span className="flex items-baseline justify-between gap-1">
                  <span className="font-medium text-neutral-900">{c.label}</span>
                  {c.status === "completed" ? <span aria-label="completed">✓</span> : null}
                </span>
                {c.time ? <span className="block text-neutral-500">{c.time}</span> : null}
                {c.planned ? <span className="block text-neutral-500">Plan: {c.planned}</span> : null}
                {c.actual ? <span className="block text-neutral-700">Did: {c.actual}</span> : null}
                {c.status === "skipped" ? <span className="block text-neutral-500">Skipped</span> : null}
                {c.adHoc ? <span className="block text-neutral-400">ad hoc</span> : null}
                {c.conflicts.length ? <span className="block text-red-600">⚠ {c.conflicts.length} conflict{c.conflicts.length > 1 ? "s" : ""}</span> : null}
              </Link>
            ))}

            <Link href={`/sessions/new?date=${day.date}`} className="mt-auto text-center text-xs text-neutral-400 hover:text-neutral-700">
              + Add
            </Link>
          </section>
        ))}
      </div>
    </div>
  );
}
