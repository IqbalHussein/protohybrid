import { dayName } from "../model";
import { isHardDay } from "./helpers";
import { HARD_WEIGHT, type Constraint, type Violation, type WeekLayout } from "./types";

const MAX = 2;

export const maxConsecutiveHardDays: Constraint<WeekLayout> = {
  id: "maxConsecutiveHardDays",
  label: "At most two hard days in a row",
  description: "No more than two consecutive days with a hard session (the week repeats, so Sunday precedes Monday).",
  severity: "hard",
  scope: "week",
  weight: HARD_WEIGHT,
  check(layout) {
    const hard = layout.days.map(isHardDay);
    if (hard.every(Boolean))
      return [{ constraint: "maxConsecutiveHardDays", message: "Every day of the week has a hard session." }];
    const out: Violation[] = [];
    const start = hard.findIndex((h) => !h); // begin after a non-hard day so no run wraps
    let run: number[] = [];
    for (let k = 1; k <= 7; k++) {
      const i = (start + k) % 7;
      if (hard[i]) run.push(i);
      if (!hard[i] || k === 7) {
        if (run.length > MAX)
          out.push({
            constraint: "maxConsecutiveHardDays",
            message: `${run.length} hard days in a row, ${dayName(run[0] + 1)} to ${dayName(run[run.length - 1] + 1)}.`,
            weekday: layout.days[run[0]].weekday,
          });
        run = [];
      }
    }
    return out;
  },
};
