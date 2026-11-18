import type { Intensity, LiftFocus, PlannedRunType, Slot, WeekKind, Weekday } from "../types";

export type Violation = {
  constraint: string;
  message: string;
  weekday?: Weekday;
  sessionKeys?: string[];
  // Score for this violation when it differs from the constraint's `weight`.
  weight?: number;
};

export type Constraint<Ctx> = {
  id: string; // part of the contract: the UI shows relaxations by id
  label: string;
  description: string;
  severity: "hard" | "soft";
  scope: "week" | "block";
  // Score added per violation when the scheduler ranks layouts.
  weight: number;
  check(ctx: Ctx): Violation[];
};

export const HARD_WEIGHT = 1000;

export type LayoutSession = {
  key: string;
  type: "run" | "lift";
  runType: PlannedRunType | null;
  liftFocus: LiftFocus | null;
  heavyLower: boolean;
  intensity: Intensity;
  durationMin: number;
  hardMin: number; // minutes at hard effort (runs only)
  slot: Slot;
};

export type DayLayout = {
  weekday: Weekday;
  budget: number; // minutes available that day
  sessions: LayoutSession[];
};

// One week as the week-scope constraints see it. `days` always has 7 entries
// (Monday first) and the week is treated as circular: Sunday precedes Monday.
export type WeekLayout = {
  kind: WeekKind;
  days: DayLayout[];
  restDays: Weekday[];
  wantsLongRun: boolean;
};
