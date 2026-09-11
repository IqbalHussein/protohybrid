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
