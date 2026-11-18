import type { Constraint, WeekLayout } from "./types";

export const HARD_SHARE_MIN = 0.1;
export const HARD_SHARE_MAX = 0.3;

// Measured by minutes: warm-up, cool-down, recoveries, easy runs and the long run count as easy.
export const runIntensityDistribution: Constraint<WeekLayout> = {
  id: "runIntensityDistribution",
  label: "80/20 run intensity",
  description: "About 80% of weekly run minutes are easy and about 20% hard (tempo blocks and interval reps).",
  severity: "soft",
  scope: "week",
  weight: 10,
  check(layout) {
    if (layout.kind !== "build" && layout.kind !== "deload") return [];
    let run = 0;
    let hard = 0;
    for (const day of layout.days)
      for (const s of day.sessions)
        if (s.type === "run" && s.runType !== "race") {
          run += s.durationMin;
          hard += s.hardMin;
        }
    if (run < 45) return [];
    const share = hard / run;
    if (share >= HARD_SHARE_MIN - 1e-9 && share <= HARD_SHARE_MAX + 1e-9) return [];
    return [
      {
        constraint: "runIntensityDistribution",
        message: `Hard running is ${Math.round(share * 100)}% of ${run} run minutes (target about 20%).`,
      },
    ];
  },
};
