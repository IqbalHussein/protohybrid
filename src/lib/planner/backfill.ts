// After placement: give unused day minutes back to sessions, steering the lift/run split
// toward the profile's target. Never beyond a day's budget.

import type { Budgets } from "./model";
import { maxSets, minutesForSets } from "./splits";
import type { Placed } from "./schedule";
import type { Experience } from "./types";

const STEP = 5;
const LIFT_SLACK = 0.095; // lifts may fill up to this far above the target share
const RUN_SLACK = 0.06; // runs may fill until lifts sit this far below it
const MIN_HARD_SHARE = 0.14; // easy/long growth must leave hard work at least this share of running

type Opts = { budgets: Budgets; liftTarget: number; experience: Experience };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// Longest a lift is worth running: its nominal time, or the time its set cap needs.
function liftCeiling(p: Placed, exp: Experience): number {
  const variant = p.spec.type === "lift" ? p.spec.variant : "volume";
  return Math.max(p.spec.durationMin, minutesForSets(maxSets(120, variant, exp), variant));
}

function spare(placed: Placed[], day: number, budgets: Budgets): number {
  return budgets[day as keyof Budgets] - sum(placed.filter((p) => p.weekday === day).map((p) => p.durationMin));
}

export function backfill(placed: Placed[], o: Opts): Placed[] {
  const out = placed.map((p) => ({ ...p }));
  const minutes = (type: "lift" | "run") => sum(out.filter((p) => p.spec.type === type).map((p) => p.durationMin));
  const hardMin = sum(out.filter((p) => p.spec.type === "run").map((p) => (p.spec.type === "run" ? p.spec.hardMin : 0)));
  const longest = Math.max(0, ...out.filter((p) => p.spec.type === "run" && p.spec.runType === "long").map((p) => p.durationMin));

  const canGrow = (p: Placed): boolean => {
    if (spare(out, p.weekday, o.budgets) < STEP) return false;
    if (p.spec.type === "lift") return p.durationMin + STEP <= liftCeiling(p, o.experience);
    if (p.spec.runType === "long") return true;
    if (p.spec.runType !== "easy") return false;
    return longest === 0 || p.durationMin + STEP <= longest - STEP;
  };

  for (let guard = 0; guard < 200; guard++) {
    const L = minutes("lift");
    const R = minutes("run");
    const share = L + R > 0 ? L / (L + R) : 0;
    const growable = out.filter(canGrow);
    if (growable.length === 0) break;
    const wantLift = o.liftTarget >= 0.1 && share < o.liftTarget;
    const lifts = growable.filter((p) => p.spec.type === "lift");
    const runs = growable.filter((p) => p.spec.type === "run");
    const liftOk = lifts.length > 0 && (L + STEP) / (L + R + STEP) <= o.liftTarget + LIFT_SLACK;
    const runOk =
      runs.length > 0 &&
      (o.liftTarget < 0.1 || L / (L + R + STEP) >= o.liftTarget - RUN_SLACK) &&
      (hardMin === 0 || hardMin / (R + STEP) >= MIN_HARD_SHARE);
    const pool = wantLift ? (liftOk ? lifts : runOk ? runs : []) : runOk ? runs : liftOk ? lifts : [];
    if (pool.length === 0) break;
    // the session with the most room to grow in its day goes first (ties: earliest day)
    const pick = pool.slice().sort((a, b) => spare(out, b.weekday, o.budgets) - spare(out, a.weekday, o.budgets) || a.weekday - b.weekday)[0];
    pick.durationMin += STEP;
  }
  return out;
}
