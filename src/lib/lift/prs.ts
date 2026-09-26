import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/plans";
import { countsAsWork, estimated1RM, setVolume } from "./math";
import type { PrRecordType, SetType } from "./types";

export type PrSet = {
  session_id: string;
  exercise_id: string;
  weight: number | null;
  reps: number | null;
  set_type: SetType;
};

export type PrSession = { id: string; achieved_at: string };

export type PrRow = {
  exercise_id: string;
  session_id: string;
  record_type: PrRecordType;
  value: number;
  weight: number | null;
  reps: number | null;
  achieved_at: string;
};

/**
 * Replays completed sessions in order and emits a record every time a working
 * set beats everything *before* its session, for each of the four PR types.
 * Warm-ups are neither PR-eligible nor counted toward volume. Within a
 * session, only the best set per exercise and type is kept.
 *
 * Replaying instead of comparing one session against "all other sessions"
 * keeps records correct when an older workout is edited or deleted after
 * later ones exist.
 */
export function computePrs(sessions: PrSession[], sets: PrSet[]): PrRow[] {
  const order = [...sessions].sort((a, b) => a.achieved_at.localeCompare(b.achieved_at));
  const bySession = new Map<string, PrSet[]>();
  for (const s of sets) {
    if (!countsAsWork(s.set_type) || s.weight == null || s.reps == null) continue;
    bySession.set(s.session_id, [...(bySession.get(s.session_id) ?? []), s]);
  }

  type Best = { heaviest: number; e1rm: number; volume: number; repsAt: Map<number, number> };
  const best = new Map<string, Best>();
  const out: PrRow[] = [];

  for (const session of order) {
    const hits = new Map<string, PrRow>();
    const hit = (row: Omit<PrRow, "session_id" | "achieved_at">) => {
      const key = `${row.exercise_id}:${row.record_type}`;
      const prev = hits.get(key);
      if (!prev || row.value > prev.value) {
        hits.set(key, { ...row, session_id: session.id, achieved_at: session.achieved_at });
      }
    };

    const sessionSets = bySession.get(session.id) ?? [];
    for (const s of sessionSets) {
      const b = best.get(s.exercise_id) ?? { heaviest: 0, e1rm: 0, volume: 0, repsAt: new Map() };
      const weight = s.weight!;
      const reps = s.reps!;
      const base = { exercise_id: s.exercise_id, weight, reps };

      if (weight > b.heaviest) hit({ ...base, record_type: "heaviest_weight", value: weight });
      const e1rm = estimated1RM(weight, reps);
      if (e1rm > b.e1rm) hit({ ...base, record_type: "best_e1rm", value: e1rm });
      const volume = setVolume(weight, reps);
      if (volume > b.volume) hit({ ...base, record_type: "best_volume", value: volume });
      // Most reps is only meaningful compared against the same weight, and
      // only once there's a previous attempt at it to beat.
      const priorReps = b.repsAt.get(weight) ?? 0;
      if (priorReps > 0 && reps > priorReps) hit({ ...base, record_type: "most_reps", value: reps });
    }

    // Fold this session in only after scoring it, so sets within one session
    // don't compete with each other as "prior history".
    for (const s of sessionSets) {
      const b = best.get(s.exercise_id) ?? { heaviest: 0, e1rm: 0, volume: 0, repsAt: new Map() };
      b.heaviest = Math.max(b.heaviest, s.weight!);
      b.e1rm = Math.max(b.e1rm, estimated1RM(s.weight, s.reps));
      b.volume = Math.max(b.volume, setVolume(s.weight, s.reps));
      b.repsAt.set(s.weight!, Math.max(b.repsAt.get(s.weight!) ?? 0, s.reps!));
      best.set(s.exercise_id, b);
    }

    out.push(...hits.values());
  }
  return out;
}

/**
 * Recomputes stored personal_records for the given exercises from scratch.
 * Called on finish, and whenever a completed workout's sets change.
 */
export async function rebuildPrs(
  supabase: SupabaseClient,
  userId: string,
  exerciseIds: string[],
): Promise<void> {
  const ids = [...new Set(exerciseIds)];
  if (!ids.length) return;

  const sessions = await fetchAll<{
    id: string;
    planned_date: string;
    lift_details: { completed_at: string | null } | { completed_at: string | null }[] | null;
  }>((from, to) =>
    supabase
      .from("sessions")
      .select("id, planned_date, lift_details(completed_at)")
      .eq("type", "lift")
      .eq("status", "completed")
      .order("id")
      .range(from, to),
  );

  const completed: PrSession[] = sessions.map((s) => {
    const d = Array.isArray(s.lift_details) ? s.lift_details[0] : s.lift_details;
    return { id: s.id, achieved_at: d?.completed_at ?? `${s.planned_date}T12:00:00Z` };
  });
  const completedIds = new Set(completed.map((s) => s.id));

  const rawSets = await fetchAll<{
    lift_details_id: string;
    exercise_id: string;
    weight: number | null;
    reps: number | null;
    set_type: SetType;
  }>((from, to) =>
    supabase
      .from("lift_sets")
      .select("lift_details_id, exercise_id, weight, reps, set_type")
      .in("exercise_id", ids)
      .order("id")
      .range(from, to),
  );

  const sets: PrSet[] = rawSets
    .filter((s) => completedIds.has(s.lift_details_id))
    .map((s) => ({
      session_id: s.lift_details_id,
      exercise_id: s.exercise_id,
      weight: s.weight == null ? null : Number(s.weight),
      reps: s.reps,
      set_type: s.set_type,
    }));

  const rows = computePrs(completed, sets);

  const { error: delError } = await supabase
    .from("personal_records")
    .delete()
    .eq("user_id", userId)
    .in("exercise_id", ids);
  if (delError) throw new Error(`Could not update PRs: ${delError.message}`);

  if (rows.length) {
    const { error } = await supabase
      .from("personal_records")
      .insert(rows.map((r) => ({ ...r, user_id: userId })));
    if (error) throw new Error(`Could not save PRs: ${error.message}`);
  }
}
