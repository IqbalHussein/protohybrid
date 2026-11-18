import type { GeneratedBlock, GeneratedWeek } from "../types";
import type { Constraint, Violation } from "./types";

export const DELOAD_MIN = 0.5;
export const DELOAD_MAX = 0.7;

const MIN_EASY = 20;
const MIN_HARD = 25;

function atRunFloor(w: GeneratedWeek): boolean {
  const runs = w.sessions.filter((s) => s.type === "run");
  return runs.length > 0 && runs.every((s) => s.durationMin <= (s.runType === "tempo" || s.runType === "interval" ? MIN_HARD : MIN_EASY));
}

export const deloadReduction: Constraint<GeneratedBlock> = {
  id: "deloadReduction",
  label: "Deload reduction",
  description: "A deload week cuts run minutes and lift sets to about 60% of the previous build week.",
  severity: "soft",
  scope: "block",
  weight: 10,
  check(block) {
    const out: Violation[] = [];
    let ref: (typeof block.weeks)[number] | null = null;
    for (const w of block.weeks) {
      if (w.kind === "build") ref = w;
      if (w.kind !== "deload" || !ref) continue;
      const pairs: [string, number, number][] = [
        ["run minutes", w.totals.runMin, ref.totals.runMin],
        ["lift sets", w.totals.liftSets, ref.totals.liftSets],
      ];
      for (const [what, now, before] of pairs) {
        if (before <= 0) continue;
        // Runs already at their minimum lengths cannot be cut further.
        if (what === "run minutes" && atRunFloor(w)) continue;
        const r = now / before;
        if (r < DELOAD_MIN - 1e-9 || r > DELOAD_MAX + 1e-9)
          out.push({
            constraint: "deloadReduction",
            message: `Deload week ${w.index} has ${Math.round(r * 100)}% of week ${ref.index}'s ${what} (target about 60%).`,
          });
      }
    }
    return out;
  },
};
