"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { saveRestPref } from "../actions";

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Countdown between sets. Tracks an end timestamp (not ticks) so it stays
// accurate when the tab is backgrounded. The duration is saved per exercise.
export function RestTimer({ exerciseId, exerciseName, initialSeconds }: {
  exerciseId: string;
  exerciseName: string;
  initialSeconds: number;
}) {
  const [duration, setDuration] = useState(initialSeconds);
  const [remaining, setRemaining] = useState(initialSeconds);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(initialSeconds));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const doneRef = useRef(false);

  useEffect(() => {
    if (endsAt === null) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0 && !doneRef.current) {
        doneRef.current = true;
        setEndsAt(null);
        setAnnouncement(`Rest over for ${exerciseName}.`);
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.([200, 100, 200]);
      }
    };
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [endsAt, exerciseName]);

  const running = endsAt !== null;

  function start() {
    doneRef.current = false;
    setAnnouncement("");
    const from = remaining > 0 ? remaining : duration;
    setRemaining(from);
    setEndsAt(Date.now() + from * 1000);
  }

  function pause() {
    setEndsAt(null);
  }

  function reset() {
    setEndsAt(null);
    setRemaining(duration);
    setAnnouncement("");
  }

  function saveDuration() {
    const seconds = Number(draft);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 3600) {
      setSaveError("Enter whole seconds from 0 to 3600.");
      return;
    }
    setSaveError(null);
    startSaving(async () => {
      const res = await saveRestPref(exerciseId, seconds);
      if (res.error) {
        setSaveError(res.error);
        return;
      }
      setDuration(seconds);
      setEndsAt(null);
      setRemaining(seconds);
      setEditing(false);
    });
  }

  const progress = duration > 0 ? remaining / duration : 0;

  return (
    <div className="flex flex-col gap-2 rounded-control border border-ink-line px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-chalk-muted">Rest</span>
        <span
          className={`stretch-wide min-w-[4ch] text-xl font-extrabold tabular-nums ${remaining === 0 && !running ? "text-lift" : ""}`}
          aria-hidden
        >
          {mmss(remaining)}
        </span>
        <div className="flex gap-1">
          {running ? (
            <Button size="sm" variant="secondary" onClick={pause}>
              Pause
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={start} disabled={duration === 0}>
              {remaining > 0 && remaining < duration ? "Resume" : "Start rest"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={reset}>
            Reset
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            {editing ? "Cancel" : "Change"}
          </Button>
        </div>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-ink-line" aria-hidden>
        <div className="h-full bg-lift transition-[width] duration-200 ease-linear" style={{ width: `${progress * 100}%` }} />
      </div>
      {editing && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-chalk-muted">
            Rest for {exerciseName} (seconds)
            <Input
              type="number"
              min="0"
              max="3600"
              step="5"
              inputMode="numeric"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-8 w-28"
            />
          </label>
          <Button size="sm" variant="secondary" onClick={saveDuration} disabled={saving}>
            {saving ? "Saving…" : "Save rest time"}
          </Button>
          {saveError && (
            <span role="alert" className="text-xs text-danger">
              {saveError}
            </span>
          )}
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
