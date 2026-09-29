import type { UserClient } from "@/lib/auth";
import { zonedDateString, zonedToUtc } from "@/lib/time";
import { replayPrs, type ReplaySession } from "./prs";
import { getCompletedSets } from "./queries";

/**
 * Keeping `personal_records` true to history.
 *
 * A record is only a record relative to everything before it, so any change
 * to logged history — finishing a workout, editing or deleting a set in a
 * finished one, deleting a workout, moving one to another date — can create,
 * move or erase records in *later* sessions too. Rather than patching around
 * each case, every one of those paths calls `rebuildPrs` for the exercises it
 * touched, which recomputes their records from the whole history.
 */

/** The exercises a session has sets for: the scope of a rebuild after it changes. */
export async function exercisesInSession(supabase: UserClient, sessionId: string): Promise<string[]> {
  const { data } = await supabase.from("lift_sets").select("exercise_id").eq("lift_details_id", sessionId);
  return [...new Set((data ?? []).map((r) => r.exercise_id as string))];
}

/**
 * Whether a session's sets are part of history yet. Sets logged into a
 * workout still in progress don't change any record until it's finished.
 */
export async function isCompleted(supabase: UserClient, sessionId: string): Promise<boolean> {
  const { data } = await supabase.from("sessions").select("status").eq("id", sessionId).maybeSingle();
  return data?.status === "completed";
}

/**
 * When a record was set, for display. The finish time when it falls on the
 * session's date; otherwise the session was moved or backfilled, and midday
 * on its date is the honest answer.
 */
export function achievedAt(date: string, completedAt: string | null): string {
  if (completedAt && zonedDateString(new Date(completedAt)) === date) return completedAt;
  return zonedToUtc(date, "12:00").toISOString();
}

/**
 * Recompute every record for these exercises from their whole completed
 * history, and replace what's stored.
 *
 * New rows go in before the old ones are removed, so a failure part-way
 * leaves the previous records in place rather than none at all.
 */
export async function rebuildPrs(supabase: UserClient, userId: string, exerciseIds: string[]): Promise<void> {
  if (!exerciseIds.length) return;

  const sets = await getCompletedSets(supabase, { exerciseIds });

  const sessions = new Map<string, ReplaySession>();
  for (const s of sets) {
    const session = sessions.get(s.lift_details_id) ?? {
      sessionId: s.lift_details_id,
      date: s.session_date,
      completedAt: s.completed_at ?? null,
      sets: [],
    };
    // The stored rows don't keep a name; findPrs only carries it through.
    session.sets.push({ ...s, exercise_name: "" });
    sessions.set(s.lift_details_id, session);
  }

  const rows = replayPrs([...sessions.values()]).flatMap(({ sessionId, hits }) => {
    const session = sessions.get(sessionId)!;
    return hits.map((h) => ({
      user_id: userId,
      exercise_id: h.exercise_id,
      record_type: h.record_type,
      value: h.value,
      weight: h.weight,
      reps: h.reps,
      session_id: sessionId,
      achieved_at: achievedAt(session.date, session.completedAt),
    }));
  });

  const { data: stale, error: readError } = await supabase
    .from("personal_records")
    .select("id")
    .in("exercise_id", exerciseIds);
  if (readError) throw new Error(`Could not update PRs: ${readError.message}`);

  if (rows.length) {
    const { error } = await supabase.from("personal_records").insert(rows);
    if (error) throw new Error(`Could not update PRs: ${error.message}`);
  }

  // Deleted by id in batches: a long history is hundreds of rows, and one
  // `in` list that long would overrun the request URL.
  const ids = (stale ?? []).map((r) => r.id as string);
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await supabase.from("personal_records").delete().in("id", ids.slice(i, i + 100));
    if (error) throw new Error(`Could not update PRs: ${error.message}`);
  }
}
