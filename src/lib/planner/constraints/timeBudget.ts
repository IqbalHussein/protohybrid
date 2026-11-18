import { dayName } from "../model";
import { HARD_WEIGHT, type Constraint, type WeekLayout } from "./types";

// Sessions stacked on one day share the day's budget. Races are exempt.
export const timeBudget: Constraint<WeekLayout> = {
  id: "timeBudget",
  label: "Time budget",
  description: "Sessions on a day add up to no more than that day's available minutes.",
  severity: "hard",
  scope: "week",
  weight: HARD_WEIGHT,
  check(layout) {
    const out = [];
    for (const day of layout.days) {
      const used = day.sessions.filter((s) => s.runType !== "race").reduce((n, s) => n + s.durationMin, 0);
      if (used > day.budget)
        out.push({
          constraint: "timeBudget",
          message: `${dayName(day.weekday)} has ${used} min planned but only ${day.budget} min available.`,
          weekday: day.weekday,
          sessionKeys: day.sessions.map((s) => s.key),
        });
    }
    return out;
  },
};
