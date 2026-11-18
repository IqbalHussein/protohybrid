// Placement of the base week's sessions onto the chosen training days.
// Exhaustive deterministic search, scored with the same week constraints the
// output is later checked against.

import type { DayLayout, LayoutSession, WeekLayout } from "./constraints";
import { layoutScore } from "./layout";
import { clamp, floor5, WEEKDAYS, type Budgets, type LiftSpec, type RunSpec, type Spec } from "./model";
import type { Slot, Weekday } from "./types";

export type PlaceInput = {
  lifts: LiftSpec[];
  runs: RunSpec[];
  days: Weekday[];
  budgets: Budgets;
  restDays: Weekday[];
  wantsLong: boolean;
};

export type Placed = { spec: Spec; weekday: Weekday; slot: Slot; durationMin: number };
export type Placement = { placed: Placed[]; score: number; layout: WeekLayout };

const STACK_PENALTY = 2; // a stacked day that is not hard run + hard lift
const SHRINK_PENALTY = 0.1; // per minute a session is shortened
const OFF_WEEKEND_PENALTY = 1; // long run not on Saturday or Sunday
const DEEP_SHRINK_PENALTY = 2.5; // per minute a lift is cut below 75% of nominal: dearer than the hard day it saves
const UNUSED_PENALTY = 0.15; // per training-day minute left empty

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// Durations of the sessions of one day, shrinking flexible ones proportionally to fit the budget.
export function fitDay(budget: number, items: Spec[]): number[] {
  const nominal = items.map((s) => s.durationMin);
  const excess = sum(nominal) - budget;
  if (excess <= 0) return nominal;
  const room = items.map((s) => s.durationMin - s.minDurationMin);
  const roomSum = sum(room);
  const out = items.map((s, i) =>
    room[i] === 0 ? s.durationMin : clamp(floor5(s.durationMin - (excess * room[i]) / roomSum), s.minDurationMin, s.durationMin),
  );
  let spare = budget - sum(out);
  while (spare >= 5) {
    let pick = -1;
    items.forEach((s, i) => {
      if (room[i] > 0 && out[i] + 5 <= nominal[i] && (pick < 0 || nominal[i] - out[i] > nominal[pick] - out[pick])) pick = i;
    });
    if (pick < 0) break;
    out[pick] += 5;
    spare -= 5;
  }
  return out;
}

function layoutSession(spec: Spec, durationMin: number, slot: Slot): LayoutSession {
  const run = spec.type === "run";
  const hardRun = run && (spec.runType === "tempo" || spec.runType === "interval");
  return {
    key: spec.id,
    type: spec.type,
    runType: run ? spec.runType : null,
    liftFocus: run ? null : spec.focus,
    heavyLower: !run && spec.heavyLower,
    intensity: run ? (hardRun ? "hard" : spec.runType === "long" ? "moderate" : "easy") : spec.variant === "heavy" ? "hard" : "moderate",
    durationMin,
    hardMin: run ? spec.hardMin : 0,
    slot,
  };
}

export function placeSessions(input: PlaceInput): Placement | null {
  const { days, budgets } = input;
  const n = days.length;
  const long = input.runs.filter((r) => r.runType === "long");
  const hard = input.runs.filter((r) => r.runType === "tempo" || r.runType === "interval");
  const easy = input.runs.filter((r) => r.runType === "easy");
  const order: Spec[] = [...input.lifts, ...long, ...hard, ...easy];
  const nLift = input.lifts.length;
  const runAt: (RunSpec | null)[] = new Array(n).fill(null);
  const liftAt: (LiftSpec | null)[] = new Array(n).fill(null);

  const fits = (i: number) =>
    (runAt[i]?.minDurationMin ?? 0) + (liftAt[i]?.minDurationMin ?? 0) <= budgets[days[i]];

  let best: { score: number; runAt: (RunSpec | null)[]; liftAt: (LiftSpec | null)[]; layout: WeekLayout } | null = null;

  function evaluate() {
    const result = buildLayout(input, runAt, liftAt);
    if (!best || result.score < best.score) best = { score: result.score, runAt: runAt.slice(), liftAt: liftAt.slice(), layout: result.layout };
  }

  function rec(k: number, lastLift: number, lastEasy: number) {
    if (k === order.length) return evaluate();
    const s = order[k];
    if (s.type === "lift") {
      for (let i = lastLift + 1; i <= n - (nLift - k); i++) {
        liftAt[i] = s;
        if (fits(i)) rec(k + 1, i, lastEasy);
        liftAt[i] = null;
      }
      return;
    }
    const isEasy = s.runType === "easy";
    const hi = isEasy ? n - 1 - (order.length - k - 1) : n - 1;
    for (let i = isEasy ? lastEasy + 1 : 0; i <= hi; i++) {
      if (runAt[i]) continue;
      runAt[i] = s;
      if (fits(i)) rec(k + 1, lastLift, isEasy ? i : lastEasy);
      runAt[i] = null;
    }
  }
  rec(0, -1, -1);

  const found = best as { score: number; runAt: (RunSpec | null)[]; liftAt: (LiftSpec | null)[]; layout: WeekLayout } | null;
  if (!found) return null;
  const placed: Placed[] = [];
  days.forEach((weekday, i) => {
    const r = found.runAt[i];
    const l = found.liftAt[i];
    const items = [r, l].filter((x): x is Spec => x !== null);
    const durations = fitDay(budgets[weekday], items);
    items.forEach((spec, j) => {
      const slot: Slot = items.length > 1 ? (spec.type === "run" ? "am" : "pm") : null;
      placed.push({ spec, weekday, slot, durationMin: durations[j] });
    });
  });
  return { placed, score: found.score, layout: found.layout };
}

function buildLayout(
  input: PlaceInput,
  runAt: (RunSpec | null)[],
  liftAt: (LiftSpec | null)[],
): { score: number; layout: WeekLayout } {
  const { days, budgets } = input;
  const dayLayouts: DayLayout[] = WEEKDAYS.map((weekday) => ({ weekday, budget: budgets[weekday], sessions: [] }));
  let extra = 0;
  days.forEach((weekday, i) => {
    const r = runAt[i];
    const l = liftAt[i];
    const items = [r, l].filter((x): x is Spec => x !== null);
    if (items.length === 0) {
      extra += UNUSED_PENALTY * budgets[weekday];
      return;
    }
    const durations = fitDay(budgets[weekday], items);
    const stacked = items.length > 1;
    const sessions = dayLayouts[weekday - 1].sessions;
    extra += UNUSED_PENALTY * (budgets[weekday] - durations.reduce((a, b) => a + b, 0));
    items.forEach((spec, j) => {
      extra += SHRINK_PENALTY * (spec.durationMin - durations[j]);
      if (spec.type === "lift") extra += DEEP_SHRINK_PENALTY * Math.max(0, Math.ceil(spec.durationMin * 0.75) - durations[j]);
      sessions.push(layoutSession(spec, durations[j], stacked ? (spec.type === "run" ? "am" : "pm") : null));
    });
    if (stacked && !(sessions[0].intensity === "hard" && sessions[1].intensity === "hard")) extra += STACK_PENALTY;
    if (r?.runType === "long" && weekday < 6) extra += OFF_WEEKEND_PENALTY;
  });
  const layout: WeekLayout = { kind: "build", days: dayLayouts, restDays: input.restDays, wantsLongRun: input.wantsLong };
  return { score: layoutScore(layout) + extra, layout };
}

// The week layout of final placements (after any later adjustment of durations).
export function layoutOfPlaced(input: PlaceInput, placed: Placed[]): WeekLayout {
  const dayLayouts: DayLayout[] = WEEKDAYS.map((weekday) => ({
    weekday,
    budget: input.budgets[weekday],
    sessions: placed.filter((p) => p.weekday === weekday).map((p) => layoutSession(p.spec, p.durationMin, p.slot)),
  }));
  return { kind: "build", days: dayLayouts, restDays: input.restDays, wantsLongRun: input.wantsLong };
}
