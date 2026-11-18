import type { LiftFocus } from "./types";
import { describe, expect, it } from "vitest";
import {
  baseSets,
  buildLiftPrescription,
  distributeSets,
  isHeavyLower,
  liftRpe,
  liftSplit,
  maxSets,
  minutesForSets,
  repScheme,
  splitLabel,
} from "./splits";

describe("liftSplit", () => {
  const focus = (n: number, r: number) => liftSplit(n, r).map((s) => s.focus);
  const variant = (n: number, r: number) => liftSplit(n, r).map((s) => s.variant);

  it("follows the split table by lift count", () => {
    expect(focus(1, 0.5)).toEqual(["full-body"]);
    expect(focus(2, 0.5)).toEqual(["full-body", "full-body"]);
    expect(focus(3, 0.7)).toEqual(["full-body", "full-body", "full-body"]);
    expect(focus(3, 0.3)).toEqual(["upper", "lower", "full-body"]);
    expect(focus(4, 0.5)).toEqual(["upper", "lower", "upper", "lower"]);
    expect(focus(5, 0.5)).toEqual(["push", "pull", "legs", "upper", "lower"]);
    expect(focus(6, 0.5)).toEqual(["push", "pull", "legs", "push", "pull", "legs"]);
    expect(focus(7, 0.5)).toEqual(["push", "pull", "legs", "push", "pull", "legs", "full-body"]);
  });

  it("alternates heavy and volume passes when strength-leaning", () => {
    expect(variant(4, 0.6)).toEqual(["heavy", "heavy", "volume", "volume"]);
    // with six or seven lifts nearly every day trains, so heavy days are kept apart
    expect(variant(6, 0.6)).toEqual(["heavy", "volume", "heavy", "volume", "heavy", "volume"]);
    expect(variant(7, 0.6)).toEqual(["heavy", "volume", "heavy", "volume", "heavy", "volume", "volume"]);
    expect(variant(3, 0.6)).toEqual(["heavy", "volume", "heavy"]);
    expect(variant(5, 0.6)).toEqual(["heavy", "heavy", "heavy", "volume", "volume"]);
  });

  it("is all volume when hypertrophy-leaning", () => {
    for (let n = 1; n <= 7; n++) expect(new Set(variant(n, 0.3))).toEqual(new Set(["volume"]));
  });

  it("marks lower, legs and full-body as heavy leg work", () => {
    expect(["lower", "legs", "full-body"].every((f) => isHeavyLower(f as never))).toBe(true);
    expect(["upper", "push", "pull"].some((f) => isHeavyLower(f as never))).toBe(false);
  });

  it("names a split", () => {
    expect(splitLabel(focus(4, 0.5))).toBe("upper/lower");
    expect(splitLabel(focus(6, 0.5))).toBe("push/pull/legs");
    expect(splitLabel(focus(2, 0.5))).toBe("full-body");
  });
});

describe("repScheme", () => {
  it("picks rep ranges by strength ratio", () => {
    expect(repScheme(0.7, "heavy")).toMatchObject({ low: 3, high: 5, restSec: 180 });
    expect(repScheme(0.7, "volume")).toMatchObject({ low: 6, high: 8 });
    expect(repScheme(0.5, "heavy")).toMatchObject({ low: 4, high: 6 });
    expect(repScheme(0.5, "volume")).toMatchObject({ low: 8, high: 10 });
    expect(repScheme(0.3, "heavy")).toMatchObject({ low: 6, high: 8 });
    expect(repScheme(0.3, "volume")).toMatchObject({ low: 8, high: 12, restSec: 90 });
  });
  it("uses higher-rep accessories for hypertrophy", () => {
    expect(repScheme(0.3, "volume")).toMatchObject({ accLow: 10, accHigh: 15 });
    expect(repScheme(0.7, "volume")).toMatchObject({ accLow: 8, accHigh: 12 });
  });
});

describe("sets", () => {
  it("scales with time, capped by experience", () => {
    expect(baseSets(60, "volume", "intermediate")).toBe(16); // 20 fit, capped at 16
    expect(baseSets(60, "heavy", "intermediate")).toBe(13);
    expect(baseSets(60, "volume", "beginner")).toBe(12);
    expect(baseSets(75, "volume", "advanced")).toBeLessThanOrEqual(20);
    expect(baseSets(30, "heavy", "intermediate")).toBe(5);
  });
  it("leaves room to add sets later", () => {
    expect(maxSets(60, "heavy", "intermediate")).toBeGreaterThan(baseSets(60, "heavy", "intermediate"));
    expect(minutesForSets(14, "heavy")).toBeLessThanOrEqual(60);
  });
  it("uses the RPE table", () => {
    expect([0, 1, 2].map((i) => liftRpe("heavy", i))).toEqual([7, 7.5, 8]);
    expect([0, 1, 2].map((i) => liftRpe("volume", i))).toEqual([7, 7.5, 8.5]);
    expect(liftRpe("deload", 3)).toBe(6);
  });
});

describe("distributeSets", () => {
  it("always sums to the total, favouring the two main lifts", () => {
    for (let total = 4; total <= 20; total++) {
      const n = Math.min(5, Math.max(2, Math.ceil(total / 3)));
      const sets = distributeSets(total, n);
      expect(sets.reduce((a, b) => a + b, 0)).toBe(total);
      expect(Math.min(...sets)).toBeGreaterThanOrEqual(total >= 2 * n ? 2 : 1);
      expect(sets[0]).toBeGreaterThanOrEqual(sets[n - 1]);
    }
  });
});

describe("buildLiftPrescription", () => {
  it("uses the suggested exercise names", () => {
    const p = buildLiftPrescription({ focus: "full-body", variant: "heavy", totalSets: 16, ratio: 0.7, rpe: 8 });
    expect(p.exercises.map((e) => e.name)).toEqual([
      "Barbell Squat",
      "Bench Press",
      "Barbell Row",
      "Romanian Deadlift",
      "Overhead Press",
    ]);
    expect(p.exercises.map((e) => e.slot)).toEqual(["Squat", "Push", "Pull", "Hinge", "Overhead"]);
  });
  it("covers every focus with the documented names", () => {
    const names = (focus: LiftFocus) =>
      buildLiftPrescription({ focus, variant: "volume", totalSets: 20, ratio: 0.5, rpe: 7 }).exercises.map((e) => e.name);
    expect(names("upper")).toEqual(["Bench Press", "Barbell Row", "Overhead Press", "Pull-Up", "Dumbbell Curl", "Triceps Pushdown"]);
    expect(names("lower")).toEqual(["Barbell Squat", "Romanian Deadlift", "Walking Lunge", "Leg Curl", "Calf Raise"]);
    expect(names("push")).toEqual(["Bench Press", "Overhead Press", "Incline Dumbbell Press", "Lateral Raise", "Triceps Pushdown"]);
    expect(names("pull")).toEqual(["Deadlift", "Pull-Up", "Seated Cable Row", "Face Pull", "Dumbbell Curl"]);
    expect(names("legs")).toEqual(["Barbell Squat", "Romanian Deadlift", "Leg Press", "Leg Curl", "Calf Raise"]);
  });
  it("reports totals, reps and a description", () => {
    const p = buildLiftPrescription({ focus: "upper", variant: "heavy", totalSets: 14, ratio: 0.7, rpe: 8 });
    expect(p.exercises.reduce((a, e) => a + e.sets, 0)).toBe(14);
    expect(p.exercises).toHaveLength(5);
    expect(p.exercises[0]).toMatchObject({ repsLow: 3, repsHigh: 5 });
    expect(p.exercises[4]).toMatchObject({ repsLow: 8, repsHigh: 12 });
    expect(p.description).toBe("5 exercises · 14 sets · 3–5 reps @ RPE 8");
  });
  it("keeps tiny sessions to two exercises", () => {
    const p = buildLiftPrescription({ focus: "full-body", variant: "volume", totalSets: 4, ratio: 0.5, rpe: 7 });
    expect(p.exercises).toHaveLength(2);
    expect(p.totalSets).toBe(4);
  });
});
