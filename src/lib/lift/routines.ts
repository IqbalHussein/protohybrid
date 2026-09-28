import { countsAsWork } from "./math";
import type { SetType } from "./types";

export type TargetSource = { reps: number | null; set_type: SetType };

/**
 * Derive a routine's targets from sets actually logged, for "save this workout
 * as a routine" (spec flow #7). Routines store targets, never weights.
 *
 * Target sets is the count of working sets. Target reps is the *most common*
 * rep count rather than the average: a 5/5/5/3 session was programmed as
 * fives, and averaging it to 4.5 invents a number that was never performed.
 * Ties go to the higher count, which keeps a 5/5/3/3 finish reading as fives.
 */
export function routineTargetsFromSets(sets: TargetSource[]): {
  targetSets: number | null;
  targetReps: number | null;
} {
  const working = sets.filter((s) => countsAsWork(s.set_type));
  if (!working.length) return { targetSets: null, targetReps: null };

  const counts = new Map<number, number>();
  for (const s of working) {
    if (s.reps == null) continue;
    counts.set(s.reps, (counts.get(s.reps) ?? 0) + 1);
  }

  let targetReps: number | null = null;
  let best = 0;
  for (const [reps, n] of counts) {
    if (n > best || (n === best && targetReps != null && reps > targetReps)) {
      best = n;
      targetReps = reps;
    }
  }

  return { targetSets: working.length, targetReps };
}
