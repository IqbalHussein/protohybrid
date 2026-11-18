import type { GeneratedBlock, GeneratedWeek, LiftPrescription } from "../types";
import type { Constraint, Violation } from "./types";

function meanRpe(w: GeneratedWeek): number {
  const rpes = w.sessions.flatMap((s) => (s.prescription.kind === "lift" ? [(s.prescription as LiftPrescription).rpe] : []));
  return rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : 0;
}

// Compares neighbouring build weeks: sets and RPE never go down while building.
export const liftProgression: Constraint<GeneratedBlock> = {
  id: "liftProgression",
  label: "Lift progression",
  description: "Lift sets and RPE do not decrease from one build week to the next.",
  severity: "soft",
  scope: "block",
  weight: 10,
  check(block) {
    const out: Violation[] = [];
    for (let i = 1; i < block.weeks.length; i++) {
      const a = block.weeks[i - 1];
      const b = block.weeks[i];
      if (a.kind !== "build" || b.kind !== "build" || a.totals.liftSets === 0) continue;
      if (b.totals.liftSets < a.totals.liftSets)
        out.push({
          constraint: "liftProgression",
          message: `Week ${b.index} has fewer lift sets (${b.totals.liftSets}) than week ${a.index} (${a.totals.liftSets}).`,
        });
      if (meanRpe(b) < meanRpe(a) - 1e-9)
        out.push({ constraint: "liftProgression", message: `Lift effort drops from week ${a.index} to week ${b.index}.` });
    }
    return out;
  },
};
