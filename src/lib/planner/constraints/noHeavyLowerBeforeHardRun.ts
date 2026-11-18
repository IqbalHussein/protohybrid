import { describeLiftRun, heavyLowerBeforeRun, isHardRun } from "./helpers";
import { HARD_WEIGHT, type Constraint, type WeekLayout } from "./types";

export const noHeavyLowerBeforeHardRun: Constraint<WeekLayout> = {
  id: "noHeavyLowerBeforeHardRun",
  label: "No heavy legs before a hard run",
  description: "No heavy lower-body lift in the 24 hours before a tempo or interval run.",
  severity: "hard",
  scope: "week",
  weight: HARD_WEIGHT,
  check(layout) {
    return heavyLowerBeforeRun(layout, isHardRun).map((p) => ({
      constraint: "noHeavyLowerBeforeHardRun",
      message: `${describeLiftRun(p)}.`,
      weekday: p.runDay.weekday,
      sessionKeys: [p.lift.key, p.run.key],
    }));
  },
};
