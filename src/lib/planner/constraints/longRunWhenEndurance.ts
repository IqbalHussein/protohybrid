import { isLongRun } from "./helpers";
import type { Constraint, WeekLayout } from "./types";

export const longRunWhenEndurance: Constraint<WeekLayout> = {
  id: "longRunWhenEndurance",
  label: "One long run a week",
  description: "One long run per week when endurance weighs 30 or more, or the goal is a race.",
  severity: "soft",
  scope: "week",
  weight: 30,
  check(layout) {
    if (!layout.wantsLongRun || (layout.kind !== "build" && layout.kind !== "deload")) return [];
    const n = layout.days.reduce((c, d) => c + d.sessions.filter(isLongRun).length, 0);
    if (n === 1) return [];
    return [
      {
        constraint: "longRunWhenEndurance",
        message: n === 0 ? "No long run this week." : `${n} long runs this week; one is enough.`,
      },
    ];
  },
};
