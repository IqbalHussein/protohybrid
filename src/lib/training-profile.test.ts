import { describe, expect, it } from "vitest";
import type { GeneratedBlock, GeneratedSession, TrainingProfile } from "@/lib/planner";
import type { TrainingProfileRow } from "@/lib/types";
import { blockStartFor, profileFromRow, profileToRow, toAcceptSessions } from "./training-profile";

const row: TrainingProfileRow = {
  user_id: "u1",
  preset: "hybrid",
  w_strength: 35,
  w_hypertrophy: 25,
  w_endurance: 40,
  days_per_week: 4,
  minutes_per_day: 60,
  minutes_by_weekday: { "2": 45, "6": 90 },
  rest_days: [7, 1],
  goal_type: "race",
  race_distance_km: 21.1,
  race_date: "2027-03-14",
  experience: "intermediate",
  created_at: "x",
  updated_at: "y",
};

describe("profile conversion", () => {
  it("maps a row to a profile", () => {
    expect(profileFromRow(row)).toEqual({
      preset: "hybrid",
      weights: { strength: 35, hypertrophy: 25, endurance: 40 },
      daysPerWeek: 4,
      minutesPerDay: 60,
      minutesByWeekday: { 2: 45, 6: 90 },
      restDays: [1, 7],
      goal: { type: "race", distanceKm: 21.1, date: "2027-03-14" },
      experience: "intermediate",
    });
  });

  it("round-trips through the row shape", () => {
    const p = profileFromRow(row);
    const { created_at: _c, updated_at: _u, ...rest } = row;
    void _c;
    void _u;
    expect(profileToRow("u1", p)).toEqual({ ...rest, rest_days: [1, 7] });
  });

  it("handles no goal and no per-day minutes", () => {
    const p = profileFromRow({ ...row, goal_type: "none", race_distance_km: null, race_date: null, minutes_by_weekday: {} });
    expect(p.goal).toEqual({ type: "none" });
    expect(p.minutesByWeekday).toBeUndefined();
    const out = profileToRow("u1", p);
    expect(out).toMatchObject({ goal_type: "none", race_distance_km: null, race_date: null, minutes_by_weekday: {} });
  });

  it("stores strength goals without race fields", () => {
    const p: TrainingProfile = { ...profileFromRow(row), goal: { type: "strength" } };
    expect(profileToRow("u1", p)).toMatchObject({ goal_type: "strength", race_distance_km: null, race_date: null });
  });
});

function session(over: Partial<GeneratedSession>): GeneratedSession {
  return {
    key: "w1-1-run",
    week: 1,
    date: "2026-11-23",
    weekday: 1,
    slot: null,
    type: "run",
    runType: "easy",
    liftFocus: null,
    heavyLower: false,
    intensity: "easy",
    durationMin: 40,
    prescription: { kind: "run", warmupMin: 5, hardMin: 0, cooldownMin: 5, reps: null, repMin: null, recoveryMin: null, description: "Easy" },
    rationale: "Why",
    ...over,
  };
}

const block: GeneratedBlock = {
  generatorVersion: "t",
  startDate: "2026-11-23",
  relaxations: [],
  summary: "s",
  weeks: [
    {
      index: 1,
      kind: "build",
      startDate: "2026-11-23",
      totals: { runMin: 0, hardRunMin: 0, liftMin: 0, liftSets: 0 },
      sessions: [
        session({}),
        session({
          key: "w1-3-lift",
          date: "2026-11-25",
          weekday: 3,
          slot: "pm",
          type: "lift",
          runType: null,
          liftFocus: "upper",
          intensity: "hard",
          prescription: { kind: "lift", variant: "heavy", rpe: 8, restSec: 150, totalSets: 0, exercises: [], description: "d" },
        }),
      ],
    },
  ],
};

describe("toAcceptSessions", () => {
  it("maps sessions with slot, key and week in the prescription", () => {
    const out = toAcceptSessions(block);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ date: "2026-11-23", type: "run", run_type: "easy", focus: null, duration_min: 40, intensity: "easy", rationale: "Why" });
    expect(out[0].prescription).toMatchObject({ kind: "run", slot: null, key: "w1-1-run", week: 1 });
    expect(out[1]).toMatchObject({ type: "lift", run_type: null, focus: "upper", intensity: "hard" });
    expect(out[1].prescription).toMatchObject({ kind: "lift", slot: "pm", key: "w1-3-lift", week: 1 });
  });

  it("drops sessions before fromDate", () => {
    expect(toAcceptSessions(block, "2026-11-24").map((s) => s.date)).toEqual(["2026-11-25"]);
    expect(toAcceptSessions(block, "2026-11-23")).toHaveLength(2);
    expect(toAcceptSessions(block, "2027-01-01")).toEqual([]);
  });
});

describe("blockStartFor", () => {
  it("returns this week's or next week's Monday", () => {
    expect(blockStartFor("2026-11-17", "this")).toBe("2026-11-16"); // Tuesday
    expect(blockStartFor("2026-11-17", "next")).toBe("2026-11-23");
    expect(blockStartFor("2026-11-16", "this")).toBe("2026-11-16"); // Monday
    expect(blockStartFor("2026-11-16", "next")).toBe("2026-11-23");
    expect(blockStartFor("2026-11-22", "next")).toBe("2026-11-23"); // Sunday
    expect(blockStartFor("2026-12-30", "next")).toBe("2027-01-04");
  });
});
