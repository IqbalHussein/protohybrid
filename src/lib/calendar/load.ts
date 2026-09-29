import { countsAsWork, setVolume } from "@/lib/lift/math";
import type { SetType } from "@/lib/lift/types";
import type { CalendarSession } from "./types";

/**
 * One week's training load, running and lifting side by side
 * (project-spec.md: "is my lower-body volume this week actually sane once
 * running is factored in?").
 *
 * Deliberately not one blended score: there's no honest exchange rate
 * between kilometres and pounds lifted, and a made-up index would hide which
 * side moved. The two are shown together, each against the week before.
 */

/** Muscle groups whose sets load the legs, as the exercise library names them. */
export const LOWER_BODY_GROUPS = new Set([
  "quadriceps",
  "hamstrings",
  "glutes",
  "calves",
  "adductors",
  "abductors",
  // The library files deadlifts under lower back, and they tax the legs a
  // runner needs as much as a squat does.
  "lower back",
]);

export type LoadSet = {
  lift_details_id: string;
  weight: number | null;
  reps: number | null;
  set_type: SetType;
  muscle_group: string | null;
};

export type WeekLoad = {
  run: {
    /** Target distance of every run on the plan that wasn't skipped. */
    plannedKm: number;
    doneKm: number;
    doneSec: number;
    doneRuns: number;
  };
  lift: {
    doneWorkouts: number;
    workingSets: number;
    lowerBodySets: number;
    /** Weight x reps over working sets, in the logger's unit (lb). */
    volume: number;
  };
};

/**
 * Totals for a week. `sets` may include sets from sessions that aren't
 * finished; only completed lifts count, like everywhere else in the app.
 * `through` (YYYY-MM-DD) cuts the week off after that date, so a week in
 * progress can be compared with the same stretch of the week before.
 */
export function weekLoad(sessions: CalendarSession[], sets: LoadSet[], through?: string): WeekLoad {
  const inRange = sessions.filter((s) => !through || s.plannedDate <= through);
  const load: WeekLoad = {
    run: { plannedKm: 0, doneKm: 0, doneSec: 0, doneRuns: 0 },
    lift: { doneWorkouts: 0, workingSets: 0, lowerBodySets: 0, volume: 0 },
  };

  for (const s of inRange) {
    if (s.type !== "run" || s.status === "skipped") continue;
    load.run.plannedKm += s.run?.target_distance_km ?? 0;
    if (s.status === "completed") {
      load.run.doneRuns += 1;
      load.run.doneKm += s.run?.actual_distance_km ?? 0;
      load.run.doneSec += s.run?.actual_duration_sec ?? 0;
    }
  }

  const doneLifts = new Set(inRange.filter((s) => s.type === "lift" && s.status === "completed").map((s) => s.id));
  load.lift.doneWorkouts = doneLifts.size;
  for (const set of sets) {
    if (!doneLifts.has(set.lift_details_id) || !countsAsWork(set.set_type)) continue;
    load.lift.workingSets += 1;
    load.lift.volume += setVolume(set.weight, set.reps);
    if (set.muscle_group && LOWER_BODY_GROUPS.has(set.muscle_group)) load.lift.lowerBodySets += 1;
  }

  return load;
}

/** Whole-percent change, or null when there's nothing to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export type LoadItem = {
  label: string;
  value: string;
  detail: string | null;
  /** Percent change against the comparison week, or null when it had none. */
  change: number | null;
};

const km = (n: number) => `${Number(n.toFixed(1))} km`;

/** The summary strip's three figures: running, lifting, and the legs taking both. */
export function describeLoad(current: WeekLoad, previous: WeekLoad): LoadItem[] {
  const { run, lift } = current;
  return [
    {
      label: "Running",
      value: km(run.doneKm),
      detail: run.plannedKm > 0 ? `of ${km(run.plannedKm)} planned` : null,
      change: percentChange(run.doneKm, previous.run.doneKm),
    },
    {
      label: "Lifting",
      value: `${Math.round(lift.volume).toLocaleString("en-US")} lb`,
      detail: `${lift.workingSets} working ${lift.workingSets === 1 ? "set" : "sets"}`,
      change: percentChange(lift.volume, previous.lift.volume),
    },
    {
      label: "Legs",
      value: `${lift.lowerBodySets} lower-body ${lift.lowerBodySets === 1 ? "set" : "sets"}`,
      detail: `plus ${km(run.doneKm)} run`,
      change: percentChange(lift.lowerBodySets, previous.lift.lowerBodySets),
    },
  ];
}
