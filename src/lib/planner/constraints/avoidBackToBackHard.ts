import { dayName } from "../model";
import { isHardDay } from "./helpers";
import type { Constraint, Violation, WeekLayout } from "./types";

export const avoidBackToBackHard: Constraint<WeekLayout> = {
  id: "avoidBackToBackHard",
  label: "Avoid back-to-back hard days",
  description: "Small penalty per pair of consecutive hard days.",
  severity: "soft",
  scope: "week",
  weight: 3,
  check(layout) {
    const out: Violation[] = [];
    layout.days.forEach((day, i) => {
      const next = layout.days[(i + 1) % 7];
      if (isHardDay(day) && isHardDay(next))
        out.push({
          constraint: "avoidBackToBackHard",
          message: `Hard sessions on ${dayName(day.weekday)} and ${dayName(next.weekday)}.`,
          weekday: next.weekday,
        });
    });
    return out;
  },
};
