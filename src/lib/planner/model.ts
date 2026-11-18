// Internal shapes shared by the allocator, scheduler and progression.
// Not part of the public API (index.ts does not export this file).

import type { Experience, Intensity, LiftFocus, PlannedRunType, Slot, TrainingProfile, Weekday } from "./types";

export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];
const NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function dayName(d: number): string {
  return NAMES[d - 1];
}

export const round5 = (n: number) => Math.round(n / 5) * 5;
export const ceil5 = (n: number) => Math.ceil(n / 5 - 1e-9) * 5;
export const floor5 = (n: number) => Math.floor(n / 5 + 1e-9) * 5;
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export type Budgets = Record<Weekday, number>;

// Budget of one weekday: the per-weekday override if set, else minutesPerDay.
export function dayBudget(profile: TrainingProfile, d: Weekday): number {
  const o = profile.minutesByWeekday?.[d];
  return typeof o === "number" ? o : profile.minutesPerDay;
}

export function budgetsOf(profile: TrainingProfile): Budgets {
  const out = {} as Budgets;
  for (const d of WEEKDAYS) out[d] = dayBudget(profile, d);
  return out;
}

export function wantsLongRun(profile: TrainingProfile): boolean {
  return profile.weights.endurance >= 30 || profile.goal.type === "race";
}

export type RunKind = "easy" | "long" | "tempo" | "interval";

// A run to be placed. Hard and long runs are fixed length; easy runs can shrink.
export type RunSpec = {
  type: "run";
  id: string;
  runType: RunKind;
  durationMin: number;
  minDurationMin: number;
  hardMin: number;
  warmupMin: number;
  alternates: boolean; // single hard run that swaps tempo/intervals week by week
};

export type LiftSpec = {
  type: "lift";
  id: string;
  focus: LiftFocus;
  variant: "heavy" | "volume";
  heavyLower: boolean;
  durationMin: number;
  minDurationMin: number;
};

export type Spec = RunSpec | LiftSpec;

export type Allocation = {
  lifts: LiftSpec[];
  runs: RunSpec[];
  ratio: number; // strength / (strength + hypertrophy), incl. goal shift
  notes: { constraint: string; title: string; detail: string }[];
  lostMin?: number; // minutes that merging easy runs could not hand to another run
};

// A session of the base week once placed: the template every week derives from.
export type BaseSession = {
  id: string;
  type: "run" | "lift";
  weekday: Weekday;
  slot: Slot;
  durationMin: number;
  runType: RunKind | null;
  alternates: boolean;
  hardMin: number;
  warmupMin: number;
  liftFocus: LiftFocus | null;
  variant: "heavy" | "volume" | null;
  heavyLower: boolean;
  sets: number;
  minDurationMin: number;
  rationale: string;
};

export type BaseWeek = {
  sessions: BaseSession[];
  ratio: number;
  experience: Experience;
  budgets: Budgets;
};

export function runIntensity(runType: PlannedRunType): Intensity {
  if (runType === "tempo" || runType === "interval" || runType === "race") return "hard";
  return runType === "long" ? "moderate" : "easy";
}
