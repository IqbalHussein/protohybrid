import type { SetType } from "./types";

// Warm-up sets are excluded from volume totals and are not PR-eligible,
// per the spec's recommendation (Hevy's convention). Drop and failure sets
// are real work and do count.
export function countsAsWork(setType: SetType): boolean {
  return setType !== "warmup";
}

export function setVolume(weight: number | null, reps: number | null): number {
  if (weight == null || reps == null) return 0;
  return weight * reps;
}

// Epley.
export function estimated1RM(weight: number | null, reps: number | null): number {
  if (weight == null || reps == null || reps <= 0) return 0;
  return weight * (1 + reps / 30);
}

export function formatDuration(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt) return "—";
  const end = endedAt ? new Date(endedAt) : new Date();
  const mins = Math.max(0, Math.round((end.getTime() - new Date(startedAt).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Rest-timer display: m:ss, clamped at zero so an overrun never renders "-0:03".
export function formatSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Weights and e1RMs are displayed to one decimal at most — 102.5 lb is real,
// 102.53333 is a floating-point artifact of the Epley multiply.
export function roundTo(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
