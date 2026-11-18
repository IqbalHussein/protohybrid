// Run prescriptions. Hard work (tempo block or interval reps) is the only thing counted as hard;
// warm-up, cool-down, jog recoveries, easy and long runs all count as easy.

import { ceil5 } from "./model";
import type { Experience, PlannedRunType, RunPrescription } from "./types";

export const MIN_HARD_RUN = 25;
export const MIN_EASY_RUN = 20;
const COOLDOWN = 5;
const RECOVERY = 2;

export type BuiltRun = { durationMin: number; prescription: RunPrescription };

export function repLength(exp: Experience): number {
  return exp === "advanced" ? 4 : 3;
}

function run(p: Partial<RunPrescription> & Pick<RunPrescription, "description">): RunPrescription {
  return { kind: "run", warmupMin: 0, hardMin: 0, cooldownMin: 0, reps: null, repMin: null, recoveryMin: null, ...p };
}

export function buildEasyRun(durationMin: number): BuiltRun {
  return { durationMin, prescription: run({ description: `${durationMin} min easy, conversational pace` }) };
}

export function buildLongRun(durationMin: number): BuiltRun {
  return {
    durationMin,
    prescription: run({ description: `${durationMin} min long run, easy and steady; finish feeling you could do more` }),
  };
}

// A tempo or interval session with about `hardTarget` minutes at hard effort.
// The total is a multiple of 5 and at least MIN_HARD_RUN; extra minutes go to the cool-down.
export function buildHardRun(runType: "tempo" | "interval", hardTarget: number, warmup: number, exp: Experience): BuiltRun {
  if (runType === "tempo") {
    const main = Math.max(1, Math.round(hardTarget));
    const total = Math.max(MIN_HARD_RUN, ceil5(warmup + main + COOLDOWN));
    const cooldown = total - warmup - main; // absorbs rounding and the 25 min minimum
    return {
      durationMin: total,
      prescription: run({
        warmupMin: warmup,
        hardMin: main,
        cooldownMin: cooldown,
        description: `${warmup} min easy, ${main} min tempo (comfortably hard), ${cooldown} min easy`,
      }),
    };
  }
  const rep = repLength(exp);
  const reps = Math.max(2, Math.round(hardTarget / rep));
  const core = reps * rep + (reps - 1) * RECOVERY;
  const total = Math.max(MIN_HARD_RUN, ceil5(warmup + core + COOLDOWN));
  const cooldown = total - warmup - core;
  return {
    durationMin: total,
    prescription: run({
      warmupMin: warmup,
      hardMin: reps * rep,
      cooldownMin: cooldown,
      reps,
      repMin: rep,
      recoveryMin: RECOVERY,
      description: `${warmup} min easy, ${reps} × ${rep} min hard / ${RECOVERY} min jog, ${cooldown} min easy`,
    }),
  };
}

// A tempo or interval session that is `total` minutes long (at least MIN_HARD_RUN):
// a tempo block takes whatever is left after warm-up and cool-down; intervals fit as many reps as they can.
export function buildHardRunByTotal(runType: "tempo" | "interval", total: number, warmup: number, exp: Experience): BuiltRun {
  const t = Math.max(MIN_HARD_RUN, total);
  // At the minimum length a short warm-up would turn most of the run into hard work.
  const w = t <= MIN_HARD_RUN ? Math.max(warmup, 10) : warmup;
  if (runType === "tempo") return buildHardRun("tempo", t - w - COOLDOWN, w, exp);
  const rep = repLength(exp);
  const reps = Math.max(2, Math.floor((t - w - COOLDOWN + RECOVERY) / (rep + RECOVERY)));
  return buildHardRun("interval", reps * rep, w, exp);
}

export function buildRace(distanceKm: number): BuiltRun {
  const km = Number.isInteger(distanceKm) ? String(distanceKm) : distanceKm.toFixed(1);
  const durationMin = Math.max(1, Math.round(distanceKm * 6));
  return { durationMin, prescription: run({ description: `Race: ${km} km` }) };
}

export function isHardType(t: PlannedRunType | string | null): t is "tempo" | "interval" {
  return t === "tempo" || t === "interval";
}
