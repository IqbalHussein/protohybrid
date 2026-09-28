"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { optionalNumber, requiredString } from "@/lib/forms";
import { findOrCreatePlanForDate } from "@/lib/plans";
import { todayInZone } from "@/lib/time";
import { getCompletedSets, getWorkout, getRestPreferences } from "@/lib/lift/queries";
import { findPrs, type PrCandidate, type PrSet } from "@/lib/lift/prs";
import { routineTargetsFromSets } from "@/lib/lift/routines";
import { shouldStartRest, type GroupedExercise } from "@/lib/lift/supersets";
import { DEFAULT_REST_SECONDS, type SetType } from "@/lib/lift/types";

/**
 * Create today's session plus its lift_details and open the logging screen.
 * Shared by the ad-hoc "Start workout" button and by starting from a routine,
 * which differ only in the focus text and whether routine_id is set.
 *
 * An ad-hoc workout can't just insert a session: sessions.plan_id is NOT NULL,
 * so it resolves today's plan first and therefore still shows up on the
 * calendar rather than existing off to one side.
 */
async function createWorkout(focus: string, routineId: string | null): Promise<string> {
  const { supabase, user } = await requireUser();
  const today = todayInZone();
  const planId = await findOrCreatePlanForDate(supabase, user.id, today);

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .insert({
      plan_id: planId,
      type: "lift",
      planned_date: today,
      status: "planned",
      routine_id: routineId,
      // Not on the calendar ahead of time, so conflict rules leave it alone.
      ad_hoc: true,
    })
    .select("id")
    .single();

  if (sessionError) throw new Error(`Could not start workout: ${sessionError.message}`);

  const { error: detailsError } = await supabase
    .from("lift_details")
    .insert({ session_id: session.id, focus, started_at: new Date().toISOString() });

  if (detailsError) throw new Error(`Could not start workout: ${detailsError.message}`);
  return session.id as string;
}

export async function startWorkout(formData: FormData) {
  const focus = String(formData.get("focus") ?? "").trim() || "general";
  const sessionId = await createWorkout(focus, null);
  redirect(`/workout/${sessionId}`);
}

export async function startWorkoutFromRoutine(formData: FormData) {
  const { supabase } = await requireUser();
  const routineId = requiredString(formData, "routineId");

  const { data: routine } = await supabase
    .from("routines")
    .select("name")
    .eq("id", routineId)
    .maybeSingle();
  if (!routine) throw new Error("Routine not found");

  const sessionId = await createWorkout(routine.name, routineId);
  redirect(`/workout/${sessionId}`);
}

/**
 * Log a set, then hand the rest timer off to the URL.
 *
 * The decision to rest depends on superset membership, which only the server
 * knows, so it is made here and passed forward as `?rest=<seconds>&at=<epoch
 * ms>`. Putting it in the URL rather than in client state means a reload mid-
 * rest resumes the same countdown instead of losing it, and re-logging always
 * produces a fresh `at` so the timer restarts.
 */
export async function addSet(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = requiredString(formData, "sessionId");
  const exerciseId = requiredString(formData, "exerciseId");
  const setType = String(formData.get("setType") || "working") as SetType;

  // Sets of the same exercise in this session define both the next set number
  // and the superset group a new set inherits.
  const { data: existing } = await supabase
    .from("lift_sets")
    .select("set_number, superset_group")
    .eq("lift_details_id", sessionId)
    .eq("exercise_id", exerciseId)
    .order("set_number", { ascending: false });

  const { error } = await supabase.from("lift_sets").insert({
    lift_details_id: sessionId,
    exercise_id: exerciseId,
    set_number: (existing?.[0]?.set_number ?? 0) + 1,
    weight: optionalNumber(formData, "weight"),
    reps: optionalNumber(formData, "reps"),
    rpe: optionalNumber(formData, "rpe"),
    set_type: setType,
    superset_group: existing?.[0]?.superset_group ?? null,
  });

  if (error) throw new Error(`Could not log set: ${error.message}`);
  revalidatePath(`/workout/${sessionId}`);

  const workout = await getWorkout(sessionId);
  const grouped: GroupedExercise[] =
    workout?.exercises.map((e) => ({ exerciseId: e.exercise.id, supersetGroup: e.supersetGroup })) ??
    [];

  if (!shouldStartRest(setType, exerciseId, grouped)) redirect(`/workout/${sessionId}`);

  const prefs = await getRestPreferences([exerciseId]);
  const seconds = prefs.get(exerciseId) ?? DEFAULT_REST_SECONDS;
  redirect(`/workout/${sessionId}?rest=${seconds}&at=${Date.now()}&ex=${exerciseId}`);
}

/**
 * Correct a logged set in place. set_number is deliberately untouched: fixing
 * a typo shouldn't reorder the exercise's sets.
 */
export async function updateSet(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = requiredString(formData, "sessionId");
  const setId = requiredString(formData, "setId");

  const { error } = await supabase
    .from("lift_sets")
    .update({
      weight: optionalNumber(formData, "weight"),
      reps: optionalNumber(formData, "reps"),
      rpe: optionalNumber(formData, "rpe"),
      set_type: String(formData.get("setType") || "working") as SetType,
    })
    .eq("id", setId);

  if (error) throw new Error(`Could not update set: ${error.message}`);
  revalidatePath(`/workout/${sessionId}`);
}

/**
 * Delete a set and close the gap it leaves. Renumbering matters because
 * `addSet` derives the next set number from the highest existing one — without
 * it, deleting set 3 of 3 and logging again would reuse number 3 while a
 * deleted middle set would leave a permanent hole in the list.
 */
export async function deleteSet(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = requiredString(formData, "sessionId");
  const setId = requiredString(formData, "setId");

  const { data: target } = await supabase
    .from("lift_sets")
    .select("exercise_id")
    .eq("id", setId)
    .maybeSingle();

  const { error } = await supabase.from("lift_sets").delete().eq("id", setId);
  if (error) throw new Error(`Could not delete set: ${error.message}`);

  if (target) {
    const { data: remaining } = await supabase
      .from("lift_sets")
      .select("id, set_number")
      .eq("lift_details_id", sessionId)
      .eq("exercise_id", target.exercise_id)
      .order("set_number", { ascending: true });

    await Promise.all(
      (remaining ?? [])
        .map((s, i) => ({ id: s.id as string, next: i + 1, current: s.set_number as number }))
        .filter((s) => s.next !== s.current)
        .map((s) => supabase.from("lift_sets").update({ set_number: s.next }).eq("id", s.id)),
    );
  }

  revalidatePath(`/workout/${sessionId}`);
}

/** Delete a whole workout. sessions cascades to lift_details, lift_sets and personal_records. */
export async function deleteWorkout(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = requiredString(formData, "sessionId");

  const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
  if (error) throw new Error(`Could not delete workout: ${error.message}`);

  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/calendar");
  redirect("/");
}

export async function updateWorkoutNotes(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = requiredString(formData, "sessionId");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const { error } = await supabase
    .from("lift_details")
    .update({ notes })
    .eq("session_id", sessionId);

  if (error) throw new Error(`Could not save notes: ${error.message}`);
  revalidatePath(`/workout/${sessionId}`);
}

export async function addExerciseToWorkout(formData: FormData) {
  // An exercise joins a workout by logging its first set, so this just
  // bounces back with the exercise pinned open on the logging screen.
  const sessionId = requiredString(formData, "sessionId");
  const exerciseId = requiredString(formData, "exerciseId");
  redirect(`/workout/${sessionId}?add=${exerciseId}`);
}

export async function createCustomExercise(formData: FormData) {
  const { supabase, user } = await requireUser();
  const sessionId = String(formData.get("sessionId") ?? "").trim();
  const name = requiredString(formData, "name");
  const muscleGroup = String(formData.get("muscleGroup") ?? "").trim() || null;

  const { data, error } = await supabase
    .from("exercises")
    .insert({ name, muscle_group: muscleGroup, is_custom: true, user_id: user.id })
    .select("id")
    .single();

  if (error) throw new Error(`Could not create exercise: ${error.message}`);

  // Reachable from the workout picker and from the routine editor; only the
  // former has a session to return to.
  redirect(sessionId ? `/workout/${sessionId}?add=${data.id}` : `/exercise/${data.id}`);
}

export async function saveRestPreference(formData: FormData) {
  const { supabase, user } = await requireUser();
  const exerciseId = requiredString(formData, "exerciseId");
  const restSeconds = optionalNumber(formData, "restSeconds");

  if (restSeconds == null || restSeconds < 0 || restSeconds > 3600) {
    throw new Error("Rest must be between 0 and 3600 seconds");
  }

  const { error } = await supabase
    .from("exercise_rest_prefs")
    .upsert(
      { user_id: user.id, exercise_id: exerciseId, rest_seconds: restSeconds, updated_at: new Date().toISOString() },
      { onConflict: "user_id,exercise_id" },
    );

  if (error) throw new Error(`Could not save rest preference: ${error.message}`);
  revalidatePath("/workout", "layout");
}

/**
 * Join an exercise to the superset above it (spec flow #4). Grouping is stored
 * on every set of the exercise, and `addSet` copies the group onto new sets,
 * so a group survives further logging.
 */
export async function groupWithPrevious(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = requiredString(formData, "sessionId");
  const exerciseId = requiredString(formData, "exerciseId");

  const workout = await getWorkout(sessionId);
  const index = workout?.exercises.findIndex((e) => e.exercise.id === exerciseId) ?? -1;
  if (!workout || index < 1) throw new Error("Nothing above this exercise to superset with");

  const previous = workout.exercises[index - 1];
  // Extend the group above when there is one, so a third exercise joins the
  // existing pair rather than starting a rival group.
  const group = previous.supersetGroup ?? crypto.randomUUID();

  const { error } = await supabase
    .from("lift_sets")
    .update({ superset_group: group })
    .eq("lift_details_id", sessionId)
    .in("exercise_id", [previous.exercise.id, exerciseId]);

  if (error) throw new Error(`Could not create superset: ${error.message}`);
  revalidatePath(`/workout/${sessionId}`);
}

/**
 * Pull one exercise out of its superset. If that leaves a single exercise
 * behind, the group is dissolved too — a superset of one is just an exercise.
 */
export async function ungroupSuperset(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = requiredString(formData, "sessionId");
  const exerciseId = requiredString(formData, "exerciseId");

  const workout = await getWorkout(sessionId);
  const self = workout?.exercises.find((e) => e.exercise.id === exerciseId);
  if (!self?.supersetGroup) return;

  const siblings = (workout?.exercises ?? []).filter(
    (e) => e.supersetGroup === self.supersetGroup && e.exercise.id !== exerciseId,
  );
  const toClear = [exerciseId, ...(siblings.length === 1 ? [siblings[0].exercise.id] : [])];

  const { error } = await supabase
    .from("lift_sets")
    .update({ superset_group: null })
    .eq("lift_details_id", sessionId)
    .in("exercise_id", toClear);

  if (error) throw new Error(`Could not ungroup: ${error.message}`);
  revalidatePath(`/workout/${sessionId}`);
}

/**
 * PR detection, run on finish. Loads this session's sets and every earlier
 * completed set for the same exercises, then defers the rules to `findPrs`.
 *
 * Idempotent: a double-clicked Finish (or a finished workout being finished
 * again) replaces this session's records instead of adding a second copy.
 */
async function detectPrs(sessionId: string) {
  const { supabase, user } = await requireUser();

  const { error: clearError } = await supabase.from("personal_records").delete().eq("session_id", sessionId);
  if (clearError) throw new Error(`Could not save PRs: ${clearError.message}`);

  const { data: session } = await supabase
    .from("sessions")
    .select("planned_date")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) throw new Error("Workout not found");

  const { data: sets } = await supabase
    .from("lift_sets")
    .select("exercise_id, weight, reps, set_type, exercises(name)")
    .eq("lift_details_id", sessionId);

  const current: PrCandidate[] = (sets ?? []).map((s) => {
    const exercise = Array.isArray(s.exercises) ? s.exercises[0] : s.exercises;
    return {
      exercise_id: s.exercise_id,
      exercise_name: (exercise as { name?: string } | null)?.name ?? "Exercise",
      weight: s.weight,
      reps: s.reps,
      set_type: s.set_type as SetType,
    };
  });
  if (!current.length) return;

  // Only finished workouts on or before this one count as "prior": an
  // abandoned workout or a later-dated one can't take this session's record
  // away from it.
  const prior: PrSet[] = await getCompletedSets(supabase, {
    exerciseIds: [...new Set(current.map((s) => s.exercise_id))],
    excludeSessionId: sessionId,
    onOrBefore: session.planned_date as string,
  });

  const hits = findPrs(current, prior);
  if (!hits.length) return;

  const { error } = await supabase.from("personal_records").insert(
    hits.map((h) => ({
      user_id: user.id,
      exercise_id: h.exercise_id,
      record_type: h.record_type,
      value: h.value,
      weight: h.weight,
      reps: h.reps,
      session_id: sessionId,
    })),
  );
  if (error) throw new Error(`Could not save PRs: ${error.message}`);
}

export async function finishWorkout(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = requiredString(formData, "sessionId");

  await detectPrs(sessionId);

  const { error: detailsError } = await supabase
    .from("lift_details")
    .update({ completed_at: new Date().toISOString() })
    .eq("session_id", sessionId);
  if (detailsError) throw new Error(`Could not finish workout: ${detailsError.message}`);

  const { error } = await supabase
    .from("sessions")
    .update({ status: "completed" })
    .eq("id", sessionId);
  if (error) throw new Error(`Could not finish workout: ${error.message}`);

  // A lift completes by being logged, which is how the calendar learns it
  // happened (weekly-calendar spec flow #4).
  revalidatePath("/calendar");
  redirect(`/workout/${sessionId}/summary`);
}

/**
 * Save a workout's exercises as a reusable routine (spec flow #7). Weights are
 * intentionally not copied — a routine is a plan, not a record.
 */
export async function saveWorkoutAsRoutine(formData: FormData) {
  const { supabase, user } = await requireUser();
  const sessionId = requiredString(formData, "sessionId");
  const name = requiredString(formData, "name");

  const workout = await getWorkout(sessionId);
  if (!workout?.exercises.length) throw new Error("Nothing to save — log a set first");

  const { data: routine, error: routineError } = await supabase
    .from("routines")
    .insert({ user_id: user.id, name })
    .select("id")
    .single();

  if (routineError) throw new Error(`Could not create routine: ${routineError.message}`);

  const rows = workout.exercises.map((e, i) => {
    const { targetSets, targetReps } = routineTargetsFromSets(e.sets);
    return {
      routine_id: routine.id,
      exercise_id: e.exercise.id,
      target_sets: targetSets,
      target_reps: targetReps,
      position: i,
    };
  });

  const { error } = await supabase.from("routine_exercises").insert(rows);
  if (error) throw new Error(`Could not save routine: ${error.message}`);

  // Attribute the session to the routine it just produced, so it counts as the
  // first data point on that routine's progress chart.
  await supabase.from("sessions").update({ routine_id: routine.id }).eq("id", sessionId);

  redirect(`/routines/${routine.id}`);
}
