import { dayName } from "../model";
import { isHardRun } from "./helpers";
import type { Constraint, Violation, WeekLayout } from "./types";

export const avoidLegsAfterHardRun: Constraint<WeekLayout> = {
  id: "avoidLegsAfterHardRun",
  label: "No heavy legs after a hard run",
  description: "Prefer no heavy lower-body lift on the day of or the day after a hard run; do upper body then.",
  severity: "soft",
  scope: "week",
  weight: 4,
  check(layout) {
    const out: Violation[] = [];
    layout.days.forEach((day, i) => {
      for (const run of day.sessions.filter(isHardRun))
        for (const di of [i, (i + 1) % 7]) {
          for (const lift of layout.days[di].sessions)
            if (lift.type === "lift" && lift.heavyLower)
              out.push({
                constraint: "avoidLegsAfterHardRun",
                message: `${dayName(layout.days[di].weekday)}'s heavy leg lift is close to ${dayName(day.weekday)}'s hard run.`,
                weekday: layout.days[di].weekday,
                sessionKeys: [run.key, lift.key],
              });
        }
    });
    return out;
  },
};
