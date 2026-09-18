"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatSeconds } from "@/lib/lift/math";
import { saveRestPreference } from "@/app/workout/actions";

const ADJUST_STEP = 15;

type Props = {
  /** Length of this rest, in seconds, already resolved from the per-exercise preference. */
  seconds: number;
  /** ISO timestamp of the set that started it — the countdown is derived from the clock, not from ticks. */
  startedAt: string;
  exerciseId: string;
  exerciseName: string;
};

/**
 * The rest timer (spec flow #3). Rendered only when the server decided a rest
 * is due — a working set outside a superset, or the last exercise of one — so
 * this component never has to know the superset rules.
 *
 * Remaining time is recomputed from `startedAt` on every tick rather than
 * decremented, so a backgrounded tab, a reload, or a slow render can't make
 * the timer drift.
 */
export default function RestTimer({ seconds, startedAt, exerciseId, exerciseName }: Props) {
  // Adjustments apply to the rest in progress; saving is a separate, explicit act.
  const [target, setTarget] = useState(seconds);
  const [remaining, setRemaining] = useState(() => remainingFrom(startedAt, seconds));
  const [dismissed, setDismissed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const firedRef = useRef(false);

  // A new set means a new rest: reset rather than carrying the old countdown.
  useEffect(() => {
    setTarget(seconds);
    setDismissed(false);
    firedRef.current = false;
  }, [seconds, startedAt]);

  useEffect(() => {
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
  }, []);

  const announce = useCallback(() => {
    beep();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Rest complete", { body: exerciseName, tag: "protohybrid-rest" });
    }
  }, [exerciseName]);

  useEffect(() => {
    if (dismissed) return;

    const tick = () => {
      const left = remainingFrom(startedAt, target);
      setRemaining(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        announce();
      }
    };

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [startedAt, target, dismissed, announce]);

  if (dismissed) return null;

  const done = remaining <= 0;
  const progress = target > 0 ? Math.min(1, Math.max(0, 1 - remaining / target)) : 1;

  return (
    <aside
      /* Fixed to the bottom so it stays visible while scrolling the set list. */
      className="fixed inset-x-0 bottom-0 z-10 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur"
      aria-label="Rest timer"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p
              className={`text-2xl font-semibold tabular-nums ${done ? "text-emerald-700" : ""}`}
              aria-live="polite"
            >
              {done ? "Rest complete" : formatSeconds(remaining)}
            </p>
            <p className="truncate text-xs text-neutral-500">{exerciseName}</p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTarget((t) => Math.max(0, t - ADJUST_STEP))}
              className="rounded border border-neutral-300 px-2.5 py-1.5 text-sm tabular-nums"
              aria-label={`Shorten rest by ${ADJUST_STEP} seconds`}
            >
              −{ADJUST_STEP}s
            </button>
            <button
              type="button"
              onClick={() => setTarget((t) => t + ADJUST_STEP)}
              className="rounded border border-neutral-300 px-2.5 py-1.5 text-sm tabular-nums"
              aria-label={`Lengthen rest by ${ADJUST_STEP} seconds`}
            >
              +{ADJUST_STEP}s
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
            >
              {done ? "Done" : "Skip"}
            </button>
          </div>
        </div>

        <div className="h-1 w-full overflow-hidden rounded bg-neutral-200">
          <div
            className="h-full bg-neutral-900 transition-[width] duration-200"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
          {target !== seconds ? (
            <form action={saveRestPreference}>
              <input type="hidden" name="exerciseId" value={exerciseId} />
              <input type="hidden" name="restSeconds" value={target} />
              <button className="underline">
                Save {formatSeconds(target)} as the default for {exerciseName}
              </button>
            </form>
          ) : (
            <span>Default for this exercise: {formatSeconds(seconds)}</span>
          )}

          {permission === "default" ? (
            <button
              type="button"
              className="underline"
              onClick={() => Notification.requestPermission().then(setPermission)}
            >
              Enable notifications
            </button>
          ) : null}
          {permission === "denied" ? <span>Notifications blocked — the timer still beeps.</span> : null}
        </div>
      </div>
    </aside>
  );
}

function remainingFrom(startedAt: string, target: number): number {
  const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000;
  return target - elapsed;
}

/**
 * A short tone via WebAudio. No audio file to ship, and it works when
 * notifications are blocked — which is the common case on a phone browser.
 */
function beep() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
    osc.onended = () => ctx.close();
  } catch {
    // Autoplay policy can refuse an AudioContext with no prior gesture; the
    // visual "Rest complete" state is the fallback.
  }
}
