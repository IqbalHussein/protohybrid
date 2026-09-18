import { countsAsWork, estimated1RM, setVolume } from "./math";
import type { PrRecordType, SetType } from "./types";

/**
 * The minimum a set needs to expose to be aggregated into a progress series.
 * `session_date` is denormalised onto the set by the query layer because
 * lift_sets only knows its lift_details_id, and charts plot against dates.
 */
export type HistorySet = {
  lift_details_id: string;
  exercise_id: string;
  weight: number | null;
  reps: number | null;
  set_type: SetType;
  session_date: string;
};

export type SessionStat = {
  sessionId: string;
  date: string;
  workingSets: number;
  volume: number;
  heaviestWeight: number;
  bestE1rm: number;
};

/**
 * Collapse a flat list of sets into one row per session, oldest first — the
 * shape both progress charts want.
 *
 * Feed it one exercise's sets for the per-exercise chart (spec Screens #5), or
 * every set from a routine's sessions for the per-routine volume chart
 * (Screens #6). The grouping key is the session, so the same function serves
 * both; the caller decides what goes in.
 *
 * Warm-ups are dropped, matching the volume and PR rules. A session whose sets
 * are all warm-ups still appears, with zeroes — it happened, and hiding it
 * would silently break the gap in a progression.
 */
export function sessionStats(sets: HistorySet[]): SessionStat[] {
  const bySession = new Map<string, SessionStat>();

  for (const s of sets) {
    let stat = bySession.get(s.lift_details_id);
    if (!stat) {
      stat = {
        sessionId: s.lift_details_id,
        date: s.session_date,
        workingSets: 0,
        volume: 0,
        heaviestWeight: 0,
        bestE1rm: 0,
      };
      bySession.set(s.lift_details_id, stat);
    }
    if (!countsAsWork(s.set_type)) continue;

    stat.workingSets += 1;
    stat.volume += setVolume(s.weight, s.reps);
    stat.heaviestWeight = Math.max(stat.heaviestWeight, s.weight ?? 0);
    stat.bestE1rm = Math.max(stat.bestE1rm, estimated1RM(s.weight, s.reps));
  }

  // Ascending by date; session id breaks ties so two workouts on one day keep
  // a stable order instead of shuffling between renders.
  return [...bySession.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.sessionId.localeCompare(b.sessionId),
  );
}

/** Total working volume across a set list, in whatever unit the weights are (lb). */
export function totalVolume(sets: Pick<HistorySet, "weight" | "reps" | "set_type">[]): number {
  return sets
    .filter((s) => countsAsWork(s.set_type))
    .reduce((sum, s) => sum + setVolume(s.weight, s.reps), 0);
}

export type StoredPr = {
  record_type: PrRecordType;
  value: number;
  weight: number | null;
  reps: number | null;
  achieved_at: string;
};

/**
 * personal_records is append-only — every time a record is broken a new row is
 * written — so the *current* best for each type is the highest value on file,
 * not the newest row. Ties go to the earlier row: the record was set then, not
 * re-set when it was matched.
 */
export function currentBests(prs: StoredPr[]): Partial<Record<PrRecordType, StoredPr>> {
  const best: Partial<Record<PrRecordType, StoredPr>> = {};
  for (const pr of prs) {
    const held = best[pr.record_type];
    if (
      !held ||
      pr.value > held.value ||
      (pr.value === held.value && pr.achieved_at < held.achieved_at)
    ) {
      best[pr.record_type] = pr;
    }
  }
  return best;
}
