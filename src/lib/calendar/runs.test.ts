import { describe, expect, it } from "vitest";
import {
  compareRun,
  describeRun,
  formatDistance,
  formatPace,
  formatRunDuration,
  minutesToSeconds,
  paceFrom,
  parsePace,
  plannedVsRan,
  runDifferences,
  secondsToMinutes,
} from "./runs";
import type { RunDetails } from "./types";

function run(over: Partial<RunDetails> = {}): RunDetails {
  return {
    run_type: "easy",
    target_distance_km: null,
    target_pace_sec_per_km: null,
    target_duration_sec: null,
    actual_distance_km: null,
    actual_pace_sec_per_km: null,
    actual_duration_sec: null,
    strava_activity_id: null,
    actual_avg_hr: null,
    actual_elevation_m: null,
    strava_name: null,
    ...over,
  };
}

describe("paceFrom", () => {
  it("is seconds per km", () => {
    expect(paceFrom(10, 3300)).toBe(330);
  });

  it("has no pace without both numbers", () => {
    expect(paceFrom(null, 3300)).toBeNull();
    expect(paceFrom(10, null)).toBeNull();
    expect(paceFrom(0, 3300)).toBeNull();
  });
});

describe("parsePace", () => {
  it("reads m:ss", () => {
    expect(parsePace("5:30")).toBe(330);
    expect(parsePace("4:05")).toBe(245);
  });

  it("reads a bare number of minutes", () => {
    expect(parsePace("5")).toBe(300);
  });

  it("reads a larger bare number as seconds already", () => {
    expect(parsePace("330")).toBe(330);
  });

  it("is null for blank or nonsense", () => {
    expect(parsePace("")).toBeNull();
    expect(parsePace(null)).toBeNull();
    expect(parsePace("fast")).toBeNull();
  });

  it("round-trips through formatPace", () => {
    expect(formatPace(parsePace("5:30"))).toBe("5:30 /km");
  });
});

describe("formatPace", () => {
  it("pads the seconds", () => {
    expect(formatPace(305)).toBe("5:05 /km");
  });

  it("has nothing to show for a missing pace", () => {
    expect(formatPace(null)).toBeNull();
    expect(formatPace(0)).toBeNull();
  });
});

describe("formatDistance", () => {
  it("drops trailing zeros, which read as false precision on a plan", () => {
    expect(formatDistance(10)).toBe("10 km");
    expect(formatDistance(10.5)).toBe("10.5 km");
    expect(formatDistance(10.25)).toBe("10.25 km");
  });

  it("shows a zero distance rather than hiding it", () => {
    expect(formatDistance(0)).toBe("0 km");
    expect(formatDistance(null)).toBeNull();
  });
});

describe("formatRunDuration", () => {
  it("renders minutes and hours", () => {
    expect(formatRunDuration(2700)).toBe("45m");
    expect(formatRunDuration(4320)).toBe("1h 12m");
    expect(formatRunDuration(7200)).toBe("2h");
  });

  it("has nothing to show for a missing duration", () => {
    expect(formatRunDuration(null)).toBeNull();
  });
});

describe("minutesToSeconds / secondsToMinutes", () => {
  it("round-trips", () => {
    expect(secondsToMinutes(minutesToSeconds(45))).toBe(45);
  });

  it("treats blank and zero as no value", () => {
    expect(minutesToSeconds(null)).toBeNull();
    expect(minutesToSeconds(0)).toBeNull();
    expect(secondsToMinutes(null)).toBeNull();
  });
});

describe("describeRun", () => {
  it("leads with distance and gives the pace", () => {
    expect(describeRun({ distanceKm: 10, durationSec: null, paceSecPerKm: 300 })).toBe("10 km @ 5:00 /km");
  });

  it("works the pace out when only distance and duration are stored", () => {
    expect(describeRun({ distanceKm: 10, durationSec: 3120, paceSecPerKm: null })).toBe("10 km @ 5:12 /km");
  });

  it("leads with duration when told to, so the actual matches a time-based plan", () => {
    expect(describeRun({ distanceKm: 8, durationSec: 2700, paceSecPerKm: null }, "duration")).toBe(
      "45m @ 5:38 /km",
    );
  });

  it("falls back to the measure it has", () => {
    expect(describeRun({ distanceKm: null, durationSec: 2700, paceSecPerKm: null }, "distance")).toBe("45m");
    expect(describeRun({ distanceKm: null, durationSec: null, paceSecPerKm: 330 })).toBe("5:30 /km pace");
    expect(describeRun({ distanceKm: null, durationSec: null, paceSecPerKm: null })).toBeNull();
  });
});

describe("compareRun / plannedVsRan", () => {
  it("puts the plan beside the result", () => {
    const r = run({
      target_distance_km: 10,
      target_pace_sec_per_km: 300,
      actual_distance_km: 9.4,
      actual_duration_sec: 2933,
      actual_pace_sec_per_km: 312,
    });
    expect(plannedVsRan(r)).toBe("Planned 10 km @ 5:00 /km · Ran 9.4 km @ 5:12 /km");
    expect(compareRun(r)).toEqual({ planned: "Planned 10 km @ 5:00 /km", ran: "Ran 9.4 km @ 5:12 /km" });
  });

  it("describes a time-based plan's result by time too", () => {
    const r = run({ target_duration_sec: 2700, actual_distance_km: 8, actual_duration_sec: 2640 });
    expect(plannedVsRan(r)).toBe("Planned 45m · Ran 44m @ 5:30 /km");
  });

  it("says completed when nothing was recorded", () => {
    expect(plannedVsRan(run({ target_distance_km: 5 }))).toBe("Planned 5 km · Completed");
  });

  it("has nothing to compare for an unplanned run", () => {
    expect(compareRun(run({ actual_distance_km: 5, actual_duration_sec: 1500 }))).toBeNull();
    expect(plannedVsRan(run({ actual_distance_km: 5 }))).toBeNull();
  });
});

describe("runDifferences", () => {
  it("names distance and pace misses", () => {
    const r = run({
      target_distance_km: 10,
      target_pace_sec_per_km: 300,
      actual_distance_km: 9.4,
      actual_pace_sec_per_km: 312,
    });
    expect(runDifferences(r)).toEqual(["0.6 km short", "0:12 /km slower"]);
  });

  it("reads over and faster", () => {
    const r = run({ target_distance_km: 10, target_pace_sec_per_km: 300, actual_distance_km: 10.5, actual_duration_sec: 3045 });
    expect(runDifferences(r)).toEqual(["0.5 km over", "0:10 /km faster"]);
  });

  it("compares duration when the plan had no distance", () => {
    expect(runDifferences(run({ target_duration_sec: 2700, actual_duration_sec: 2400 }))).toEqual(["5m shorter"]);
  });

  it("is empty when on plan, ignoring GPS-sized noise", () => {
    const r = run({ target_distance_km: 10, target_pace_sec_per_km: 300, actual_distance_km: 10.03, actual_pace_sec_per_km: 302 });
    expect(runDifferences(r)).toEqual([]);
  });

  it("is null when nothing is on both sides", () => {
    expect(runDifferences(run({ target_pace_sec_per_km: 300 }))).toBeNull();
    expect(runDifferences(run({ actual_distance_km: 5 }))).toBeNull();
  });
});
