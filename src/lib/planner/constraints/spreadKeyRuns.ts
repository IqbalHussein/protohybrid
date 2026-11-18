import { dayName } from "../model";
import type { Constraint, DayLayout, Violation, WeekLayout } from "./types";

// Cost of a pair of back-to-back key runs. Both are dearer than stacking hard sessions
// (stackHardSessions, 6 a day), so the search spreads them whenever a layout allows.
export const HARD_PAIR_COST = 40; // tempo/interval next to tempo/interval
export const LONG_PAIR_COST = 18; // the long run next to a tempo, interval or another long run

const isKey = (s: { type: string; runType: string | null }) =>
  s.type === "run" && (s.runType === "tempo" || s.runType === "interval" || s.runType === "long");
const keyRun = (d: DayLayout) => d.sessions.find(isKey);

export const spreadKeyRuns: Constraint<WeekLayout> = {
  id: "spreadKeyRuns",
  label: "Spread key runs",
  description: "Avoid tempo, interval and long runs on consecutive days, and never two hard runs back to back.",
  severity: "soft",
  scope: "week",
  weight: LONG_PAIR_COST,
  check(layout) {
    const out: Violation[] = [];
    layout.days.forEach((day, i) => {
      const next = layout.days[(i + 1) % 7];
      const a = keyRun(day);
      const b = keyRun(next);
      if (!a || !b) return;
      const hardPair = a.runType !== "long" && b.runType !== "long";
      out.push({
        constraint: "spreadKeyRuns",
        message: `${dayName(day.weekday)}'s ${a.runType} run and ${dayName(next.weekday)}'s ${b.runType} run are on consecutive days.`,
        weekday: next.weekday,
        sessionKeys: [a.key, b.key],
        weight: hardPair ? HARD_PAIR_COST : LONG_PAIR_COST,
      });
    });
    return out;
  },
};
