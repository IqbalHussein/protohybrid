import { countsAsWork } from "./math";
import type { SetType } from "./types";

/**
 * Planned vs. done for a lift started from a routine (spec MVP #4): each
 * exercise's targets beside what was logged.
 *
 * Targets are read from the routine as it is now — routines don't keep
 * versions, so an edit since the workout moves the goalposts. Matching is by
 * exercise, not position, since exercises are often logged out of order.
 */

export type PlannedExercise = {
  exerciseId: string;
  name: string;
  targetSets: number | null;
  targetReps: number | null;
};

export type DoneSet = { exerciseId: string; name: string; reps: number | null; set_type: SetType };

export type PlanStatus =
  /** Every target set done, each at or above the target reps. */
  | "met"
  /** Started but fewer sets, or fewer reps, than planned. */
  | "short"
  /** In the routine, never logged. */
  | "skipped"
  /** Logged, but not in the routine. */
  | "added";

export type PlanComparisonRow = {
  exerciseId: string;
  name: string;
  /** "3 × 5", "3 sets", "× 5"; null for an exercise added on the day. */
  planned: string | null;
  /** "3 × 5", "3 sets: 5, 5, 3"; null when nothing was logged. */
  done: string | null;
  status: PlanStatus;
};

/** Routine order first, then anything added on the day in the order it was logged. */
export function comparePlan(planned: PlannedExercise[], sets: DoneSet[]): PlanComparisonRow[] {
  // Warm-ups aren't what a routine's target sets count (see routineTargetsFromSets).
  const working = new Map<string, { name: string; reps: (number | null)[] }>();
  for (const set of sets) {
    if (!countsAsWork(set.set_type)) continue;
    const entry = working.get(set.exerciseId) ?? { name: set.name, reps: [] };
    entry.reps.push(set.reps);
    working.set(set.exerciseId, entry);
  }

  const rows: PlanComparisonRow[] = planned.map((p) => {
    const reps = working.get(p.exerciseId)?.reps ?? [];
    return {
      exerciseId: p.exerciseId,
      name: p.name,
      planned: formatTarget(p.targetSets, p.targetReps),
      done: formatDone(reps),
      status: statusOf(p, reps),
    };
  });

  const inPlan = new Set(planned.map((p) => p.exerciseId));
  for (const [exerciseId, { name, reps }] of working) {
    if (inPlan.has(exerciseId)) continue;
    rows.push({ exerciseId, name, planned: null, done: formatDone(reps), status: "added" });
  }

  return rows;
}

function statusOf(planned: PlannedExercise, reps: (number | null)[]): PlanStatus {
  if (!reps.length) return "skipped";
  if (planned.targetSets != null && reps.length < planned.targetSets) return "short";
  if (planned.targetReps != null) {
    // Only the sets the plan asked for are held to its rep target; an extra
    // back-off set at lower reps doesn't undo a met plan.
    const counted = planned.targetSets != null ? reps.slice(0, planned.targetSets) : reps;
    if (counted.some((r) => r == null || r < planned.targetReps!)) return "short";
  }
  return "met";
}

export function formatTarget(sets: number | null, reps: number | null): string | null {
  if (sets != null && reps != null) return `${sets} × ${reps}`;
  if (sets != null) return `${sets} ${sets === 1 ? "set" : "sets"}`;
  if (reps != null) return `× ${reps}`;
  return null;
}

/** Uniform sets collapse to "3 × 5"; anything else lists the reps. */
export function formatDone(reps: (number | null)[]): string | null {
  if (!reps.length) return null;
  const shown = reps.map((r) => (r == null ? "—" : String(r)));
  if (reps[0] != null && shown.every((r) => r === shown[0])) return `${reps.length} × ${shown[0]}`;
  return `${reps.length} ${reps.length === 1 ? "set" : "sets"}: ${shown.join(", ")}`;
}

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  met: "On plan",
  short: "Short",
  skipped: "Skipped",
  added: "Added",
};
