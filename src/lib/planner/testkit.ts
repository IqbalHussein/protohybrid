// Fixtures shared by the planner tests. Not exported from the planner API.

import type { DayLayout, LayoutSession, WeekLayout } from "./constraints";
import { presetWeights } from "./presets";
import type {
  GeneratedBlock,
  GeneratedSession,
  GeneratedWeek,
  Preset,
  TrainingProfile,
  WeekKind,
  Weekday,
} from "./types";

let counter = 0;

export function sess(p: Partial<LayoutSession> = {}): LayoutSession {
  counter += 1;
  return {
    key: `s${counter}`,
    type: "run",
    runType: "easy",
    liftFocus: null,
    heavyLower: false,
    intensity: "easy",
    durationMin: 40,
    hardMin: 0,
    slot: null,
    ...p,
  };
}

export const easyRun = (min = 40, o: Partial<LayoutSession> = {}) => sess({ runType: "easy", durationMin: min, ...o });
export const longRun = (min = 60, o: Partial<LayoutSession> = {}) =>
  sess({ runType: "long", intensity: "moderate", durationMin: min, ...o });
export const tempoRun = (min = 30, o: Partial<LayoutSession> = {}) =>
  sess({ runType: "tempo", intensity: "hard", durationMin: min, hardMin: min - 15, ...o });
export const intervalRun = (min = 35, o: Partial<LayoutSession> = {}) =>
  sess({ runType: "interval", intensity: "hard", durationMin: min, hardMin: 12, ...o });
// A full-body or lower lift loads the legs; upper lifts do not.
export const legLift = (min = 50, o: Partial<LayoutSession> = {}) =>
  sess({ type: "lift", runType: null, liftFocus: "lower", heavyLower: true, intensity: "hard", durationMin: min, ...o });
export const upperLift = (min = 50, o: Partial<LayoutSession> = {}) =>
  sess({ type: "lift", runType: null, liftFocus: "upper", heavyLower: false, intensity: "moderate", durationMin: min, ...o });

export type WeekSpec = {
  days?: Partial<Record<Weekday, LayoutSession[]>>;
  budget?: number | Partial<Record<Weekday, number>>;
  restDays?: Weekday[];
  wantsLongRun?: boolean;
  kind?: WeekKind;
};

// A WeekLayout from a map weekday -> sessions. Stacked days get AM/PM slots in the given order.
export function layout(spec: WeekSpec = {}): WeekLayout {
  const days: DayLayout[] = ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((weekday) => {
    const sessions = (spec.days?.[weekday] ?? []).map((s, i, all) => ({
      ...s,
      slot: all.length > 1 ? (i === 0 ? ("am" as const) : ("pm" as const)) : null,
    }));
    const b = typeof spec.budget === "number" ? spec.budget : (spec.budget?.[weekday] ?? 60);
    return { weekday, budget: b, sessions };
  });
  return { kind: spec.kind ?? "build", days, restDays: spec.restDays ?? [], wantsLongRun: spec.wantsLongRun ?? false };
}

export function profile(over: Partial<TrainingProfile> & { preset?: Preset } = {}): TrainingProfile {
  const preset = over.preset ?? "hybrid";
  return {
    preset,
    weights: presetWeights(preset),
    daysPerWeek: 4,
    minutesPerDay: 60,
    restDays: [],
    goal: { type: "none" },
    experience: "intermediate",
    ...over,
  };
}

// Block fixtures for the block-scope constraints.
export type WeekFixture = { kind: WeekKind; runMin: number; liftSets: number; rpe?: number };

export function block(weeks: WeekFixture[]): GeneratedBlock {
  const gen: GeneratedWeek[] = weeks.map((w, i) => {
    const sessions: GeneratedSession[] =
      w.liftSets > 0
        ? [
            {
              key: `w${i + 1}-1-lift`,
              week: i + 1,
              date: "2026-01-05",
              weekday: 1,
              slot: null,
              type: "lift",
              runType: null,
              liftFocus: "full-body",
              heavyLower: true,
              intensity: "moderate",
              durationMin: 45,
              prescription: {
                kind: "lift",
                variant: "volume",
                rpe: w.rpe ?? 7,
                restSec: 90,
                totalSets: w.liftSets,
                exercises: [],
                description: "",
              },
              rationale: "x",
            },
          ]
        : [];
    return {
      index: i + 1,
      kind: w.kind,
      startDate: "2026-01-05",
      sessions,
      totals: { runMin: w.runMin, hardRunMin: 0, liftMin: 0, liftSets: w.liftSets },
    };
  });
  return { generatorVersion: "test", startDate: "2026-01-05", weeks: gen, relaxations: [], summary: "" };
}
