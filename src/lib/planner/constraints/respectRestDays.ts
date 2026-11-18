import { dayName } from "../model";
import type { Constraint, Violation, WeekLayout } from "./types";

export const respectRestDays: Constraint<WeekLayout> = {
  id: "respectRestDays",
  label: "Respect rest days",
  description: "Avoid training on days you prefer to rest.",
  severity: "soft",
  scope: "week",
  weight: 20,
  check(layout) {
    const out: Violation[] = [];
    for (const day of layout.days)
      if (day.sessions.length > 0 && layout.restDays.includes(day.weekday))
        out.push({
          constraint: "respectRestDays",
          message: `${dayName(day.weekday)} is a preferred rest day but has training.`,
          weekday: day.weekday,
          sessionKeys: day.sessions.map((s) => s.key),
        });
    return out;
  },
};
