// Lifting split, rep schemes and exercise selection.

import { clamp } from "./model";
import type { Experience, LiftExercise, LiftFocus, LiftPrescription, LiftVariant } from "./types";

export type SplitSlot = { focus: LiftFocus; variant: "heavy" | "volume" };

const H = "heavy";
const V = "volume";

function focuses(n: number, strengthLean: boolean): LiftFocus[] {
  switch (n) {
    case 1:
      return ["full-body"];
    case 2:
      return ["full-body", "full-body"];
    case 3:
      return strengthLean ? ["full-body", "full-body", "full-body"] : ["upper", "lower", "full-body"];
    case 4:
      return ["upper", "lower", "upper", "lower"];
    case 5:
      return ["push", "pull", "legs", "upper", "lower"];
    case 6:
      return ["push", "pull", "legs", "push", "pull", "legs"];
    default:
      return ["push", "pull", "legs", "push", "pull", "legs", "full-body"];
  }
}

// Strength-leaning splits alternate heavy and volume passes; hypertrophy splits are all volume.
const HEAVY_PATTERN: Record<number, ("heavy" | "volume")[]> = {
  1: [H],
  2: [H, V],
  3: [H, V, H],
  4: [H, H, V, V],
  5: [H, H, H, V, V],
  6: [H, V, H, V, H, V], // (6 and 7) lifts fill the week, so keep heavy days apart
  7: [H, V, H, V, H, V, V],
};

export function liftSplit(n: number, ratio: number): SplitSlot[] {
  const count = clamp(Math.round(n), 1, 7);
  const lean = ratio >= 0.5;
  return focuses(count, lean).map((focus, i) => ({ focus, variant: lean ? HEAVY_PATTERN[count][i] : V }));
}

// Lifts that load the legs; matches the app's existing conflict rule.
export function isHeavyLower(focus: LiftFocus): boolean {
  return focus === "lower" || focus === "legs" || focus === "full-body";
}

export function splitLabel(focusList: LiftFocus[]): string {
  const set = new Set(focusList);
  if (set.size === 1 && set.has("full-body")) return "full-body";
  if (set.has("push") || set.has("pull") || set.has("legs")) return "push/pull/legs";
  if (set.has("upper") && set.has("lower")) return "upper/lower";
  return [...set].join("/");
}

export function focusLabel(focus: LiftFocus): string {
  return { "full-body": "full-body", upper: "upper-body", lower: "lower-body", push: "push", pull: "pull", legs: "leg" }[focus];
}

export type RepScheme = { low: number; high: number; restSec: number; accLow: number; accHigh: number };

export function repScheme(ratio: number, variant: LiftVariant): RepScheme {
  const hyp = ratio <= 0.4;
  const acc = hyp ? { accLow: 10, accHigh: 15 } : { accLow: 8, accHigh: 12 };
  const heavy = variant === "heavy";
  if (ratio >= 0.6) return heavy ? { low: 3, high: 5, restSec: 180, ...acc } : { low: 6, high: 8, restSec: 120, ...acc };
  if (hyp) return heavy ? { low: 6, high: 8, restSec: 120, ...acc } : { low: 8, high: 12, restSec: 90, ...acc };
  return heavy ? { low: 4, high: 6, restSec: 150, ...acc } : { low: 8, high: 10, restSec: 105, ...acc };
}

const SESSION_SET_CAP: Record<Experience, number> = { beginner: 12, intermediate: 16, advanced: 20 };
const WARMUP_MIN = 8;

export function minutesPerSet(variant: LiftVariant): number {
  return variant === "heavy" ? 3.5 : 2.5;
}

// Sets that comfortably fit a session (10% slack for transitions), within the experience cap.
export function baseSets(durationMin: number, variant: LiftVariant, exp: Experience): number {
  const raw = Math.floor((durationMin * 0.9 - WARMUP_MIN) / minutesPerSet(variant));
  return clamp(raw, 2, SESSION_SET_CAP[exp]);
}

// The most sets that physically fit in `minutes` with no slack.
export function maxSets(minutes: number, variant: LiftVariant, exp: Experience): number {
  return clamp(Math.floor((minutes - WARMUP_MIN) / minutesPerSet(variant)), 2, SESSION_SET_CAP[exp]);
}

export function minutesForSets(sets: number, variant: LiftVariant): number {
  return Math.ceil((WARMUP_MIN + sets * minutesPerSet(variant)) / 5) * 5;
}

const SLOTS: Record<LiftFocus, [string, string][]> = {
  "full-body": [
    ["Squat", "Barbell Squat"],
    ["Push", "Bench Press"],
    ["Pull", "Barbell Row"],
    ["Hinge", "Romanian Deadlift"],
    ["Overhead", "Overhead Press"],
  ],
  upper: [
    ["Horizontal push", "Bench Press"],
    ["Horizontal pull", "Barbell Row"],
    ["Vertical push", "Overhead Press"],
    ["Vertical pull", "Pull-Up"],
    ["Biceps", "Dumbbell Curl"],
    ["Triceps", "Triceps Pushdown"],
  ],
  lower: [
    ["Squat", "Barbell Squat"],
    ["Hinge", "Romanian Deadlift"],
    ["Lunge", "Walking Lunge"],
    ["Hamstring curl", "Leg Curl"],
    ["Calves", "Calf Raise"],
  ],
  push: [
    ["Horizontal push", "Bench Press"],
    ["Vertical push", "Overhead Press"],
    ["Incline press", "Incline Dumbbell Press"],
    ["Lateral raise", "Lateral Raise"],
    ["Triceps", "Triceps Pushdown"],
  ],
  pull: [
    ["Hinge", "Deadlift"],
    ["Vertical pull", "Pull-Up"],
    ["Horizontal pull", "Seated Cable Row"],
    ["Rear delts", "Face Pull"],
    ["Biceps", "Dumbbell Curl"],
  ],
  legs: [
    ["Squat", "Barbell Squat"],
    ["Hinge", "Romanian Deadlift"],
    ["Leg press", "Leg Press"],
    ["Hamstring curl", "Leg Curl"],
    ["Calves", "Calf Raise"],
  ],
};

// Splits `total` sets over n exercises: the first two (main lifts) weigh 1.5, the rest 1;
// each gets at least 2 sets when possible; largest remainder for the rest.
export function distributeSets(total: number, n: number): number[] {
  const weights = Array.from({ length: n }, (_, i) => (i < 2 ? 1.5 : 1));
  const floorEach = total >= 2 * n ? 2 : Math.floor(total / n);
  const left = total - floorEach * n;
  const sum = weights.reduce((a, b) => a + b, 0);
  const quotas = weights.map((w) => (left * w) / sum);
  const out = quotas.map((q) => floorEach + Math.floor(q));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = quotas.map((q, i) => ({ i, frac: q - Math.floor(q) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    out[i]++;
    rest--;
  }
  return out;
}

export type LiftBuild = { focus: LiftFocus; variant: LiftVariant; totalSets: number; ratio: number; rpe: number };

export function buildLiftPrescription(b: LiftBuild): LiftPrescription {
  const list = SLOTS[b.focus];
  const total = Math.max(2, b.totalSets);
  const n = clamp(Math.ceil(total / 3), 2, list.length);
  const scheme = repScheme(b.ratio, b.variant);
  const sets = distributeSets(total, n);
  const exercises: LiftExercise[] = sets.map((s, i) => ({
    slot: list[i][0],
    name: list[i][1],
    sets: s,
    repsLow: i < 2 ? scheme.low : scheme.accLow,
    repsHigh: i < 2 ? scheme.high : scheme.accHigh,
  }));
  return {
    kind: "lift",
    variant: b.variant,
    rpe: b.rpe,
    restSec: scheme.restSec,
    totalSets: total,
    exercises,
    description: `${n} exercises · ${total} sets · ${scheme.low}–${scheme.high} reps @ RPE ${b.rpe}`,
  };
}

// Target RPE by build week index (0-based) and variant; deload and recovery use 6.
export function liftRpe(variant: LiftVariant, buildIndex: number): number {
  if (variant === "deload") return 6;
  const table = variant === "heavy" ? [7, 7.5, 8] : [7, 7.5, 8.5];
  return table[Math.min(buildIndex, 2)];
}
