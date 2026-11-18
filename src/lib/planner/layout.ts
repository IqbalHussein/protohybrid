// Bridges generated weeks and the week-scope constraints, and ranks layouts.

import { WEEK_CONSTRAINTS, type DayLayout, type LayoutSession, type Violation, type WeekLayout } from "./constraints";
import { dayBudget, WEEKDAYS, wantsLongRun } from "./model";
import type { GeneratedSession, GeneratedWeek, LiftPrescription, TrainingProfile } from "./types";

export function layoutSessionOf(s: GeneratedSession): LayoutSession {
  return {
    key: s.key,
    type: s.type,
    runType: s.runType,
    liftFocus: s.liftFocus,
    heavyLower: s.heavyLower,
    intensity: s.intensity,
    durationMin: s.durationMin,
    hardMin: s.prescription.kind === "run" ? s.prescription.hardMin : 0,
    slot: s.slot,
  };
}

// The week as the week-scope constraints see it (sessions in day order, AM before PM).
export function weekLayoutOf(profile: TrainingProfile, week: GeneratedWeek): WeekLayout {
  const days: DayLayout[] = WEEKDAYS.map((d) => ({
    weekday: d,
    budget: dayBudget(profile, d),
    sessions: week.sessions
      .filter((s) => s.weekday === d)
      .sort((a, b) => (a.slot === "pm" ? 1 : 0) - (b.slot === "pm" ? 1 : 0))
      .map(layoutSessionOf),
  }));
  return { kind: week.kind, days, restDays: profile.restDays, wantsLongRun: wantsLongRun(profile) };
}

export function checkWeek(layout: WeekLayout): Violation[] {
  return WEEK_CONSTRAINTS.flatMap((c) => c.check(layout));
}

const WEIGHTS = new Map(WEEK_CONSTRAINTS.map((c) => [c.id, c.weight]));

// Sum of constraint weights over all violations; lower is better.
export function layoutScore(layout: WeekLayout): number {
  let score = 0;
  for (const c of WEEK_CONSTRAINTS) for (const v of c.check(layout)) score += v.weight ?? c.weight;
  return score;
}

export function weightOf(constraintId: string): number {
  return WEIGHTS.get(constraintId) ?? 0;
}

export function liftRpeOf(s: GeneratedSession): number | null {
  return s.prescription.kind === "lift" ? (s.prescription as LiftPrescription).rpe : null;
}
