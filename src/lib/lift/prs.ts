import { countsAsWork, estimated1RM, setVolume } from "./math";
import type { PrHit, PrRecordType, SetType } from "./types";

/** The minimum a set needs to expose for PR comparison. */
export type PrSet = {
  exercise_id: string;
  weight: number | null;
  reps: number | null;
  set_type: SetType;
};

/** A set from the session being finished, carrying its exercise's name for display. */
export type PrCandidate = PrSet & { exercise_name: string };

/**
 * Compare this session's sets against every prior set for the same exercises
 * and return the records broken. Pure so the rules are testable without a
 * database; `detectPrs` in the workout actions supplies the rows.
 *
 * Rules, all four from the spec:
 *   - heaviest_weight — most weight on a single set, any rep count
 *   - best_e1rm       — Epley estimate
 *   - best_volume     — highest single-set weight × reps
 *   - most_reps       — most reps *at a given weight*, so it only fires when
 *                       that exact weight has been lifted before; without that
 *                       guard, every first-ever set at a new weight would
 *                       trivially "beat" a nonexistent prior.
 *
 * Warm-ups are excluded on both sides. Sets missing a weight or a rep count
 * are skipped — a bodyweight-only entry has no comparable number.
 *
 * With no history at all, the first three record types do fire: a first
 * working set genuinely is that exercise's best so far, which is also how
 * Hevy behaves.
 *
 * At most one hit per (exercise, record type) is returned, holding the best
 * value of the session.
 */
export function findPrs(current: PrCandidate[], prior: PrSet[]): PrHit[] {
  const working = current.filter((s) => countsAsWork(s.set_type));
  const priorWorking = prior.filter((s) => countsAsWork(s.set_type));

  const bestPrior = (exerciseId: string, score: (s: PrSet) => number) =>
    priorWorking
      .filter((s) => s.exercise_id === exerciseId)
      .reduce((max, s) => Math.max(max, score(s)), 0);

  const hits: PrHit[] = [];
  const record = (
    set: PrCandidate,
    type: PrRecordType,
    value: number,
  ) => {
    const existing = hits.find((h) => h.exercise_id === set.exercise_id && h.record_type === type);
    if (existing) {
      if (value > existing.value) {
        existing.value = value;
        existing.weight = set.weight;
        existing.reps = set.reps;
      }
      return;
    }
    hits.push({
      exercise_id: set.exercise_id,
      exercise_name: set.exercise_name,
      record_type: type,
      value,
      weight: set.weight,
      reps: set.reps,
    });
  };

  for (const s of working) {
    const { weight, reps } = s;
    if (weight == null || reps == null) continue;

    if (weight > bestPrior(s.exercise_id, (p) => p.weight ?? 0)) {
      record(s, "heaviest_weight", weight);
    }

    const e1rm = estimated1RM(weight, reps);
    if (e1rm > bestPrior(s.exercise_id, (p) => estimated1RM(p.weight, p.reps))) {
      record(s, "best_e1rm", e1rm);
    }

    const volume = setVolume(weight, reps);
    if (volume > bestPrior(s.exercise_id, (p) => setVolume(p.weight, p.reps))) {
      record(s, "best_volume", volume);
    }

    const priorRepsAtWeight = priorWorking
      .filter((p) => p.exercise_id === s.exercise_id && p.weight === weight)
      .reduce((max, p) => Math.max(max, p.reps ?? 0), 0);
    if (priorRepsAtWeight > 0 && reps > priorRepsAtWeight) {
      record(s, "most_reps", reps);
    }
  }

  return hits;
}
