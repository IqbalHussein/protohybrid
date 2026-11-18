import { isHardDay } from "./helpers";
import type { Constraint, Violation, WeekLayout } from "./types";

// Hard sessions share days (hard run AM, hard lift PM) so the other days can stay easy.
// One violation per hard day beyond the minimum the hard sessions need.
export const stackHardSessions: Constraint<WeekLayout> = {
  id: "stackHardSessions",
  label: "Stack hard sessions",
  description: "Prefer putting hard sessions on the same day so other days stay easy.",
  severity: "soft",
  scope: "week",
  weight: 6,
  check(layout) {
    let runs = 0;
    let lifts = 0;
    let hardDays = 0;
    for (const day of layout.days) {
      if (isHardDay(day)) hardDays++;
      for (const s of day.sessions)
        if (s.intensity === "hard") {
          if (s.type === "run") runs++;
          else lifts++;
        }
    }
    const out: Violation[] = [];
    for (let i = 0; i < hardDays - Math.max(runs, lifts); i++)
      out.push({ constraint: "stackHardSessions", message: "Hard sessions could share a day to keep another day easy." });
    return out;
  },
};
