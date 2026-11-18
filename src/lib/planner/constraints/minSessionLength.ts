import { dayName } from "../model";
import { HARD_WEIGHT, type Constraint, type Violation, type WeekLayout } from "./types";

export const MIN_LIFT_MIN = 30;
export const MIN_EASY_RUN_MIN = 20;
export const MIN_HARD_RUN_MIN = 25;

export const minSessionLength: Constraint<WeekLayout> = {
  id: "minSessionLength",
  label: "Minimum session length",
  description: `Lifts take at least ${MIN_LIFT_MIN} min, easy and long runs ${MIN_EASY_RUN_MIN} min, hard runs ${MIN_HARD_RUN_MIN} min.`,
  severity: "hard",
  scope: "week",
  weight: HARD_WEIGHT,
  check(layout) {
    const out: Violation[] = [];
    for (const day of layout.days) {
      for (const s of day.sessions) {
        let min = 0;
        let what = "";
        if (s.type === "lift") [min, what] = [MIN_LIFT_MIN, "lift"];
        else if (s.runType === "tempo" || s.runType === "interval") [min, what] = [MIN_HARD_RUN_MIN, "hard run"];
        else if (s.runType !== "race") [min, what] = [MIN_EASY_RUN_MIN, "run"];
        if (s.durationMin < min)
          out.push({
            constraint: "minSessionLength",
            message: `${dayName(day.weekday)}'s ${what} is ${s.durationMin} min, under the ${min} min minimum.`,
            weekday: day.weekday,
            sessionKeys: [s.key],
          });
      }
    }
    return out;
  },
};
