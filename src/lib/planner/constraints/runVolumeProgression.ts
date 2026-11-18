import type { GeneratedBlock } from "../types";
import { HARD_WEIGHT, type Constraint, type Violation } from "./types";

export const MAX_RUN_GROWTH = 1.1;

// Only build weeks count; deload, race and recovery weeks are never the reference.
export const runVolumeProgression: Constraint<GeneratedBlock> = {
  id: "runVolumeProgression",
  label: "Run volume progression",
  description: "Each build week's run minutes are at most 10% above the previous build week.",
  severity: "hard",
  scope: "block",
  weight: HARD_WEIGHT,
  check(block) {
    const out: Violation[] = [];
    let prev: { index: number; min: number } | null = null;
    for (const w of block.weeks) {
      if (w.kind !== "build") continue;
      if (prev && prev.min > 0 && w.totals.runMin > prev.min * MAX_RUN_GROWTH + 1e-9)
        out.push({
          constraint: "runVolumeProgression",
          message: `Week ${w.index} has ${w.totals.runMin} run min, more than 10% above week ${prev.index} (${prev.min} min).`,
        });
      prev = { index: w.index, min: w.totals.runMin };
    }
    return out;
  },
};
