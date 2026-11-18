import { dayName } from "../model";
import { heavyLowerBeforeRun, isLongRun } from "./helpers";
import type { Constraint, WeekLayout } from "./types";

export const protectLongRun: Constraint<WeekLayout> = {
  id: "protectLongRun",
  label: "Protect the long run",
  description: "Avoid a heavy lower-body lift the day before the long run.",
  severity: "soft",
  scope: "week",
  weight: 8,
  check(layout) {
    return heavyLowerBeforeRun(layout, isLongRun).map((p) => ({
      constraint: "protectLongRun",
      message: `${dayName(p.runDay.weekday)}'s long run follows a heavy leg lift.`,
      weekday: p.runDay.weekday,
      sessionKeys: [p.lift.key, p.run.key],
    }));
  },
};
