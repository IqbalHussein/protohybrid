// Allocation of the base week: how many sessions of which kind and length,
// before they are placed on days. Minutes first.

import {
  ceil5,
  clamp,
  round5,
  WEEKDAYS,
  wantsLongRun,
  type Allocation,
  type Budgets,
  type LiftSpec,
  type RunSpec,
} from "./model";
import { isHeavyLower, liftSplit } from "./splits";
import { buildHardRun, MIN_EASY_RUN, MIN_HARD_RUN } from "./runs";
import type { Experience, TrainingProfile, Weekday } from "./types";

type Note = Allocation["notes"][number];

// Sessions removed because they did not fit; applied after the natural allocation.
export type Caps = { lifts: number; easy: number; hard: number; long: boolean };
export const NO_CAPS: Caps = { lifts: 7, easy: 7, hard: 2, long: true };

// How far a lift may be cut when it shares a day: 75% of nominal (never under 40 min), 40 min, or half (30 min minimum).
export type LiftFloor = "strict" | "mid" | "loose";

const LIFT_PREF: Record<Experience, number> = { beginner: 45, intermediate: 60, advanced: 75 };

type Ctx = {
  profile: TrainingProfile;
  days: Weekday[];
  maxBudget: number;
  total: number;
  caps: Caps;
  tight: boolean;
  floor: LiftFloor;
};

function planLifts(c: Ctx, ratio: number, notes: Note[]): LiftSpec[] {
  const { weights } = c.profile;
  const liftShare = (weights.strength + weights.hypertrophy) / 100;
  if (liftShare < 0.1) return [];
  const Lm = c.total * liftShare;
  const liftLen = Math.min(LIFT_PREF[c.profile.experience], c.maxBudget);
  let n = Math.max(1, Math.round(Lm / liftLen));
  while (n > 1 && Lm / n < 24) n--;
  n = Math.min(n, c.days.length, 7);
  let duration = clamp(round5(Lm / n), 30, Math.max(30, c.maxBudget));
  let min =
    c.floor === "strict"
      ? Math.min(duration, Math.max(40, ceil5(duration * 0.75)))
      : c.floor === "mid"
        ? Math.min(duration, 40)
        : Math.min(duration, Math.max(30, ceil5(duration * 0.5)));
  if (c.maxBudget < 30) {
    duration = c.maxBudget;
    min = duration;
    notes.push({
      constraint: "minSessionLength",
      title: "Lifting sessions shorter than 30 minutes",
      detail: `Your longest day is ${c.maxBudget} min, so lifts are capped at ${c.maxBudget} min, under the usual 30 min minimum.`,
    });
  }
  return liftSplit(Math.min(n, c.caps.lifts), ratio).map((s, i) => ({
    type: "lift",
    id: `lift-${i}`,
    focus: s.focus,
    variant: s.variant,
    heavyLower: isHeavyLower(s.focus),
    durationMin: duration,
    minDurationMin: min,
  }));
}

export const longMin = (dur: number) => Math.min(dur, Math.max(MIN_EASY_RUN, ceil5(dur * 0.7)));

function easySpec(i: number, dur: number): RunSpec {
  return {
    type: "run",
    id: `run-easy-${i}`,
    runType: "easy",
    durationMin: dur,
    minDurationMin: Math.min(dur, Math.max(MIN_EASY_RUN, ceil5(dur * 0.5))),
    hardMin: 0,
    warmupMin: 0,
    alternates: false,
  };
}

function hardSpec(i: number, runType: "tempo" | "interval", target: number, warm: number, exp: Experience, alt: boolean): RunSpec {
  const built = buildHardRun(runType, target, warm, exp);
  return {
    type: "run",
    id: `run-hard-${i}`,
    runType,
    durationMin: built.durationMin,
    minDurationMin: built.durationMin,
    hardMin: built.prescription.hardMin,
    warmupMin: warm,
    alternates: alt,
  };
}

function hardTypes(n: number): ("tempo" | "interval")[] {
  if (n <= 0) return [];
  return n >= 2 ? ["interval", "tempo"] : ["tempo"];
}

function planRuns(c: Ctx, Rm: number, notes: Note[]): RunSpec[] {
  const { profile, maxBudget } = c;
  const race = profile.goal.type === "race";
  const hasLong = wantsLongRun(profile) && c.caps.long;
  const D = c.days.length;
  const warm = c.tight ? 5 : 10;
  const exp = profile.experience;
  if (Rm < 15 && !race) {
    if (profile.weights.endurance >= 10)
      notes.push({
        constraint: "timeBudget",
        title: "Not enough time for running",
        detail: `Only about ${Math.round(Rm)} min a week are left for running, too little for a session, so this plan has no runs.`,
      });
    return [];
  }
  const runMin = Math.max(Rm, race ? 20 : 0);

  let nHard = 0;
  if (0.2 * runMin >= 8) nHard = runMin >= 180 && D >= 4 ? 2 : 1;
  else if (runMin >= 15)
    notes.push({
      constraint: "runIntensityDistribution",
      title: "No quality run",
      detail: "Weekly running is too short for a quality session, so all runs are easy.",
    });
  if (nHard > 0 && maxBudget < Math.max(MIN_HARD_RUN, warm + 5 + 10)) {
    notes.push({
      constraint: "runIntensityDistribution",
      title: "No quality run",
      detail: `A tempo or interval run needs about ${MIN_HARD_RUN} min, more than your longest day (${maxBudget} min).`,
    });
    nHard = 0;
  }
  const alt = nHard === 1;
  const types = hardTypes(nHard);
  let hard = types.map((t, i) => hardSpec(i, t, (0.2 * runMin) / nHard, warm, exp, alt));
  const maxHard = Math.max(0, ...hard.map((h) => h.durationMin));
  const hardSum = hard.reduce((a, h) => a + h.durationMin, 0);

  const longProv = hasLong ? Math.min(maxBudget, Math.max(MIN_EASY_RUN, round5(0.3 * runMin), maxHard + 10)) : 0;
  const rem = runMin - longProv - hardSum;
  const easyLen = Math.min(40, maxBudget);
  const room = Math.max(0, D - (hasLong ? 1 : 0) - nHard);
  const nEasy = rem >= 15 ? Math.min(room, Math.max(1, Math.round(rem / easyLen))) : 0;
  const easyCap = hasLong ? Math.max(MIN_EASY_RUN, maxBudget - 10) : maxBudget;
  const easyDur = nEasy > 0 ? clamp(round5(rem / nEasy), MIN_EASY_RUN, Math.max(MIN_EASY_RUN, easyCap)) : 0;
  const longDur = hasLong ? Math.min(maxBudget, Math.max(longProv, easyDur + 10)) : 0;

  const easies = Array.from({ length: Math.min(nEasy, c.caps.easy) }, (_, i) => easySpec(i, easyDur));
  hard = hard.slice(0, c.caps.hard);

  // One adjustment pass: size hard work at about 20% of the run minutes actually planned.
  const total = longDur + easies.length * easyDur + hard.reduce((a, h) => a + h.durationMin, 0);
  if (hard.length > 0)
    hard = hard.map((h, i) => hardSpec(i, h.runType as "tempo" | "interval", (0.2 * total) / hard.length, warm, exp, alt));

  // A quality run needs a hard block of at least 10 min that stays within 25% of the week's running.
  const hardTotal = hard.reduce((a, h) => a + h.hardMin, 0);
  if (hard.length > 0 && (hard.some((h) => h.hardMin < 10) || hardTotal / total > 0.25)) {
    notes.push({
      constraint: "runIntensityDistribution",
      title: "No quality run",
      detail: `Weekly running (about ${total} min) is too short for a hard block of 10 min or more, so all runs are easy.`,
    });
    easies.push(...hard.map((h, i) => easySpec(easies.length + i, h.durationMin)));
    hard = [];
  }

  const long: RunSpec[] = hasLong
    ? [{ ...easySpec(0, longDur), id: "run-long", runType: "long", minDurationMin: longMin(longDur) }]
    : [];
  return [...long, ...hard, ...easies];
}

export function allocate(
  profile: TrainingProfile,
  days: Weekday[],
  budgets: Budgets,
  caps: Caps,
  tight: boolean,
  floor: LiftFloor = "strict",
): Allocation {
  const notes: Note[] = [];
  const trainBudgets = days.map((d) => budgets[d]);
  const total = trainBudgets.reduce((a, b) => a + b, 0);
  const maxBudget = Math.max(0, ...trainBudgets);
  const c: Ctx = { profile, days, maxBudget, total, caps, tight, floor };
  const { strength, hypertrophy, endurance } = profile.weights;

  let ratio = strength + hypertrophy === 0 ? 0.5 : strength / (strength + hypertrophy);
  if (profile.goal.type === "strength") {
    ratio = Math.min(1, ratio + 0.15);
    if (endurance > 50)
      notes.push({
        constraint: "goalConflict",
        title: "Strength goal, endurance-heavy focus",
        detail: `Endurance is weighted at ${endurance}%, so only about ${100 - endurance}% of your time goes to lifting. Strength gains will be limited.`,
      });
  }
  if (profile.goal.type === "race" && endurance < 30)
    notes.push({
      constraint: "goalConflict",
      title: "Race goal, low endurance focus",
      detail: `Endurance is weighted at only ${endurance}%. The plan still includes a weekly long run, but running volume is low for a race.`,
    });

  const lifts = planLifts(c, ratio, notes);
  const runs = planRuns(c, total * (endurance / 100), notes);
  return { lifts, runs, ratio, notes };
}

export function trainingDaysOf(budgets: Budgets): Weekday[] {
  return WEEKDAYS.filter((d) => budgets[d] > 0);
}

// Variant of an allocation with `k` easy runs merged away: their minutes go to the remaining
// easy runs (and then the long run), each up to the largest day budget.
export function mergeEasyRuns(a: Allocation, k: number, maxBudget: number): Allocation {
  const easies = a.runs.filter((r) => r.runType === "easy");
  if (k <= 0 || easies.length === 0) return a;
  const drop = Math.min(k, easies.length);
  const kept = easies.slice(0, easies.length - drop);
  const freed = easies.slice(easies.length - drop).reduce((n, r) => n + r.durationMin, 0);
  const long = a.runs.find((r) => r.runType === "long");
  const easyCap = long ? Math.max(MIN_EASY_RUN, Math.min(maxBudget, long.durationMin - 5)) : maxBudget;
  let left = freed;
  const grown = kept.map((r) => {
    const add = kept.length ? Math.max(0, Math.min(easyCap - r.durationMin, round5(freed / kept.length))) : 0;
    left -= add;
    return { ...r, durationMin: r.durationMin + add, minDurationMin: Math.min(r.durationMin + add, Math.max(MIN_EASY_RUN, ceil5((r.durationMin + add) * 0.5))) };
  });
  const runs = a.runs.flatMap((r) => {
    if (r.runType === "easy") return grown.filter((g) => g.id === r.id);
    if (r.runType === "long" && left > 0) {
      const d = Math.min(maxBudget, r.durationMin + round5(left));
      left -= d - r.durationMin;
      return [{ ...r, durationMin: d, minDurationMin: longMin(d) }];
    }
    return [r];
  });
  return { ...a, runs, lostMin: Math.max(0, left) };
}
