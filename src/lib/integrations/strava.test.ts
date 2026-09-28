import { describe, expect, it } from "vitest";
import { activityActuals, activityPlacement, classifyRun, isRun, pickPlannedRun, type StravaActivity } from "./strava";

function activity(over: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 123,
    name: "Morning Run",
    type: "Run",
    sport_type: "Run",
    workout_type: 0,
    start_date: "2026-09-16T10:30:00Z", // 6:30am Toronto
    distance: 10_040,
    moving_time: 3000,
    average_heartrate: 151.3,
    total_elevation_gain: 42,
    ...over,
  };
}

describe("isRun", () => {
  it("keeps runs of every kind and drops everything else", () => {
    expect(isRun(activity({ sport_type: "TrailRun" }))).toBe(true);
    expect(isRun(activity({ sport_type: "VirtualRun" }))).toBe(true);
    expect(isRun(activity({ sport_type: "Ride", type: "Ride" }))).toBe(false);
    // Older activities only carry the deprecated `type`.
    expect(isRun(activity({ sport_type: undefined, type: "Run" }))).toBe(true);
  });
});

describe("classifyRun", () => {
  it("maps Strava's workout types onto run types", () => {
    expect(classifyRun(activity({ workout_type: 1 }))).toBe("race");
    expect(classifyRun(activity({ workout_type: 2 }))).toBe("long");
    expect(classifyRun(activity({ workout_type: 3 }))).toBe("interval");
    expect(classifyRun(activity({ workout_type: null }))).toBe("easy");
  });
});

describe("activityActuals", () => {
  it("converts to the units run_details stores", () => {
    expect(activityActuals(activity())).toEqual({
      actual_distance_km: 10.04,
      actual_duration_sec: 3000,
      actual_pace_sec_per_km: 299,
      actual_avg_hr: 151.3,
      actual_elevation_m: 42,
      actual_started_at: "2026-09-16T10:30:00Z",
      strava_activity_id: "123",
      strava_name: "Morning Run",
    });
  });

  it("leaves pace blank for a zero-distance activity rather than dividing by zero", () => {
    expect(activityActuals(activity({ distance: 0 })).actual_pace_sec_per_km).toBeNull();
  });

  it("leaves heart rate and elevation blank when Strava has none", () => {
    const a = activityActuals(activity({ average_heartrate: undefined, total_elevation_gain: undefined }));
    expect(a.actual_avg_hr).toBeNull();
    expect(a.actual_elevation_m).toBeNull();
  });
});

describe("activityPlacement", () => {
  it("places the run in the app's zone", () => {
    expect(activityPlacement(activity())).toEqual({ date: "2026-09-16", startTime: "06:30", durationMin: 50 });
  });

  it("puts a late-evening run on the local day, not the UTC one", () => {
    // 01:30 UTC on the 17th is 9:30pm on the 16th in Toronto.
    expect(activityPlacement(activity({ start_date: "2026-09-17T01:30:00Z" })).date).toBe("2026-09-16");
  });
});

describe("pickPlannedRun", () => {
  it("returns nothing when nothing was planned", () => {
    expect(pickPlannedRun([], activity())).toBeNull();
  });

  it("prefers a run of the same kind", () => {
    const picked = pickPlannedRun(
      [
        { id: "tempo", status: "planned", run_type: "tempo" },
        { id: "long", status: "planned", run_type: "long" },
      ],
      activity({ workout_type: 2 }),
    );
    expect(picked?.id).toBe("long");
  });

  it("prefers a still-planned run over one already marked done by hand", () => {
    const picked = pickPlannedRun(
      [
        { id: "manual", status: "completed", run_type: "easy" },
        { id: "open", status: "planned", run_type: "tempo" },
      ],
      activity(),
    );
    expect(picked?.id).toBe("open");
  });

  it("still fills in a hand-completed run when it's the only one that day", () => {
    const picked = pickPlannedRun([{ id: "manual", status: "completed", run_type: "easy" }], activity());
    expect(picked?.id).toBe("manual");
  });
});
