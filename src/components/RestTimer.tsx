"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const EVENT = "protohybrid:rest-timer";
const STORAGE_KEY = "protohybrid:rest-ends-at";

// Called by the set form after a working set is logged.
export function startRestTimer(seconds: number) {
  window.dispatchEvent(new CustomEvent<number>(EVENT, { detail: seconds }));
}

function store(value: number | null) {
  try {
    if (value == null) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Storage can be unavailable (private mode); the timer still works in-page.
  }
}

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // Audio may be blocked until the user interacts with the page.
  }
}

function notifyDone() {
  beep();
  navigator.vibrate?.([200, 100, 200]);
  if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
    new Notification("Rest's up", { body: "Time for your next set." });
  }
}

export function RestTimer() {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  const current = useRef<number | null>(null);

  const set = useCallback((value: number | null) => {
    fired.current = false;
    current.current = value;
    setEndsAt(value);
    setNow(Date.now());
    store(value);
  }, []);

  // Restore across navigations/reloads within the tab.
  useEffect(() => {
    try {
      const saved = Number(sessionStorage.getItem(STORAGE_KEY));
      if (saved > Date.now()) {
        current.current = saved;
        setEndsAt(saved);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const onStart = (e: Event) => {
      const seconds = (e as CustomEvent<number>).detail;
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission();
      }
      set(Date.now() + seconds * 1000);
    };
    window.addEventListener(EVENT, onStart);
    return () => window.removeEventListener(EVENT, onStart);
  }, [set]);

  useEffect(() => {
    if (endsAt == null) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= endsAt && !fired.current) {
        fired.current = true;
        notifyDone();
        // Hide the finished timer shortly after — unless a new one has
        // started in the meantime (next set logged quickly).
        setTimeout(() => {
          if (current.current === endsAt) set(null);
        }, 3000);
      }
    }, 250);
    return () => clearInterval(id);
  }, [endsAt, set]);

  if (endsAt == null) return null;

  const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const label = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-neutral-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
        <span className="text-sm text-neutral-500">{remaining === 0 ? "Rest done" : "Rest"}</span>
        <span className="font-mono text-2xl tabular-nums" aria-live="polite">
          {label}
        </span>
        <div className="ml-auto flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => set(Math.max(Date.now(), endsAt - 15_000))}
            className="rounded border border-neutral-300 px-2.5 py-1.5"
          >
            −15s
          </button>
          <button
            type="button"
            onClick={() => set(Math.max(Date.now(), endsAt) + 15_000)}
            className="rounded border border-neutral-300 px-2.5 py-1.5"
          >
            +15s
          </button>
          <button type="button" onClick={() => set(null)} className="rounded bg-neutral-900 px-3 py-1.5 text-white">
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
