import { describe, expect, it } from "vitest";
import { describeLoad, percentChange, weekLoad, type LoadSet } from "./load";
import type { CalendarSession, RunType } from "./types";

function run(id: string, date: string, status: CalendarSession["status"], target: number | null, actual: number | null): CalendarSession {
  return {
    id,
    type: "run",
    status,
    plannedDate: date,
    startMin: null,
    durationMin: null,
    routineId: null,
    adHoc: false,
    lift: null,
    run: {
      run_type: "easy" as RunType,
      target_distance_km: target,
      target_pace_sec_per_km: null,
      target_duration_sec: null,
      actual_distance_km: actual,
      actual_pace_sec_per_km: null,
      actual_duration_sec: actual ? Math.round(actual * 330) : null,
      strava_activity_id: null,
      actual_avg_hr: null,
      actual_elevation_m: null,
      strava_name: null,
    },
  };
}

function lift(id: string, date: string, status: CalendarSession["status"]): CalendarSession {
  return {
    id,
    type: "lift",
    status,
    plannedDate: date,
    startMin: null,
    durationMin: null,
    routineId: null,
    adHoc: false,
    run: null,
    lift: { focus: "legs", notes: null, started_at: null, completed_at: null },
  };
}

const set = (session: string, weight: number, reps: number, muscle: string | null, type: LoadSet["set_type"] = "working"): LoadSet => ({
  lift_details_id: session,
  weight,
  reps,
  set_type: type,
  muscle_group: muscle,
});

describe("weekLoad", () => {
  it("adds up running plan and actuals, leaving skipped runs out of both", () => {
    const load = weekLoad(
      [
        run("a", "2026-09-14", "completed", 10, 10.4),
        run("b", "2026-09-16", "planned", 8, null),
        run("c", "2026-09-18", "skipped", 20, null),
      ],
      [],
    );
    expect(load.run).toEqual({ plannedKm: 18, doneKm: 10.4, doneSec: 3432, doneRuns: 1 });
  });

  it("counts working sets from finished lifts only, and picks out the legs", () => {
    const load = weekLoad(
      [lift("done", "2026-09-15", "completed"), lift("open", "2026-09-17", "planned")],
      [
        set("done", 225, 5, "quadriceps"),
        set("done", 135, 5, "quadriceps", "warmup"),
        set("done", 315, 3, "lower back"),
        set("done", 185, 8, "chest"),
        set("open", 405, 1, "quadriceps"),
      ],
    );
    expect(load.lift).toEqual({ doneWorkouts: 1, workingSets: 3, lowerBodySets: 2, volume: 225 * 5 + 315 * 3 + 185 * 8 });
  });

  it("stops at `through`, for comparing a week in progress", () => {
    const sessions = [run("a", "2026-09-14", "completed", 5, 5), run("b", "2026-09-19", "completed", 15, 15)];
    expect(weekLoad(sessions, [], "2026-09-16").run.doneKm).toBe(5);
  });
});

describe("percentChange", () => {
  it("rounds to whole percent and has nothing to say against a zero week", () => {
    expect(percentChange(33, 30)).toBe(10);
    expect(percentChange(20, 40)).toBe(-50);
    expect(percentChange(5, 0)).toBeNull();
  });
});

describe("describeLoad", () => {
  it("shows running, lifting and legs against the previous week", () => {
    const current = weekLoad(
      [run("r", "2026-09-14", "completed", 30, 33), lift("l", "2026-09-15", "completed")],
      [set("l", 200, 5, "quadriceps")],
    );
    const previous = weekLoad([run("r0", "2026-09-07", "completed", 30, 30)], []);
    expect(describeLoad(current, previous)).toEqual([
      { label: "Running", value: "33 km", detail: "of 30 km planned", change: 10 },
      { label: "Lifting", value: "1,000 lb", detail: "1 working set", change: null },
      { label: "Legs", value: "1 lower-body set", detail: "plus 33 km run", change: null },
    ]);
  });
});
