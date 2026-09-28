"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, type UserClient } from "@/lib/auth";
import { optionalNumber, requiredString } from "@/lib/forms";

export async function createRoutine(formData: FormData) {
  const { supabase, user } = await requireUser();
  const name = requiredString(formData, "name");

  const { data, error } = await supabase
    .from("routines")
    .insert({ user_id: user.id, name })
    .select("id")
    .single();

  // routines is unique on (user_id, name); 23505 is Postgres' unique violation.
  if (error) {
    throw new Error(
      error.code === "23505" ? `You already have a routine called “${name}”` : `Could not create routine: ${error.message}`,
    );
  }

  redirect(`/routines/${data.id}`);
}

export async function renameRoutine(formData: FormData) {
  const { supabase } = await requireUser();
  const routineId = requiredString(formData, "routineId");
  const name = requiredString(formData, "name");

  const { error } = await supabase.from("routines").update({ name }).eq("id", routineId);
  if (error) throw new Error(`Could not rename routine: ${error.message}`);

  revalidatePath(`/routines/${routineId}`);
  revalidatePath("/routines");
}

export async function deleteRoutine(formData: FormData) {
  const { supabase } = await requireUser();
  const routineId = requiredString(formData, "routineId");

  // routine_exercises cascades; sessions.routine_id is ON DELETE SET NULL, so
  // deleting a routine loses its progress grouping but never a logged workout.
  const { error } = await supabase.from("routines").delete().eq("id", routineId);
  if (error) throw new Error(`Could not delete routine: ${error.message}`);

  revalidatePath("/routines");
  redirect("/routines");
}

export async function addRoutineExercise(formData: FormData) {
  const { supabase } = await requireUser();
  const routineId = requiredString(formData, "routineId");
  const exerciseId = requiredString(formData, "exerciseId");

  const { data: last } = await supabase
    .from("routine_exercises")
    .select("position")
    .eq("routine_id", routineId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("routine_exercises").insert({
    routine_id: routineId,
    exercise_id: exerciseId,
    target_sets: optionalNumber(formData, "targetSets"),
    target_reps: optionalNumber(formData, "targetReps"),
    position: (last?.position ?? -1) + 1,
  });

  if (error) throw new Error(`Could not add exercise: ${error.message}`);
  revalidatePath(`/routines/${routineId}`);
}

export async function updateRoutineExercise(formData: FormData) {
  const { supabase } = await requireUser();
  const routineId = requiredString(formData, "routineId");
  const id = requiredString(formData, "id");

  const { error } = await supabase
    .from("routine_exercises")
    .update({
      target_sets: optionalNumber(formData, "targetSets"),
      target_reps: optionalNumber(formData, "targetReps"),
    })
    .eq("id", id);

  if (error) throw new Error(`Could not update target: ${error.message}`);
  revalidatePath(`/routines/${routineId}`);
}

export async function removeRoutineExercise(formData: FormData) {
  const { supabase } = await requireUser();
  const routineId = requiredString(formData, "routineId");
  const id = requiredString(formData, "id");

  const { error } = await supabase.from("routine_exercises").delete().eq("id", id);
  if (error) throw new Error(`Could not remove exercise: ${error.message}`);

  await compactPositions(supabase, routineId);
  revalidatePath(`/routines/${routineId}`);
}

/**
 * Move an exercise one place up or down.
 *
 * routine_exercises is unique on (routine_id, position). That constraint is
 * declared DEFERRABLE, but each PostgREST request is its own transaction, so a
 * straight two-row swap trips it on the first update. Parking one row at a
 * negative position — which nothing else can occupy — makes the swap safe
 * across three separate statements.
 */
export async function moveRoutineExercise(formData: FormData) {
  const { supabase } = await requireUser();
  const routineId = requiredString(formData, "routineId");
  const id = requiredString(formData, "id");
  const direction = requiredString(formData, "direction");

  const { data: rows } = await supabase
    .from("routine_exercises")
    .select("id, position")
    .eq("routine_id", routineId)
    .order("position");

  const ordered = rows ?? [];
  const index = ordered.findIndex((r) => r.id === id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= ordered.length) return;

  const a = ordered[index];
  const b = ordered[swapWith];

  await supabase.from("routine_exercises").update({ position: -1 }).eq("id", a.id);
  await supabase.from("routine_exercises").update({ position: a.position }).eq("id", b.id);
  await supabase.from("routine_exercises").update({ position: b.position }).eq("id", a.id);

  revalidatePath(`/routines/${routineId}`);
}

/** Re-close position gaps left by a removal, so 0,1,3 becomes 0,1,2. */
async function compactPositions(
  supabase: UserClient,
  routineId: string,
) {
  const { data: rows } = await supabase
    .from("routine_exercises")
    .select("id, position")
    .eq("routine_id", routineId)
    .order("position");

  // Sequential, not parallel: the unique (routine_id, position) constraint is
  // checked per statement, and shifting rows down one at a time in ascending
  // order never lands on a position that is still occupied.
  for (const [index, row] of (rows ?? []).entries()) {
    if (row.position === index) continue;
    await supabase.from("routine_exercises").update({ position: index }).eq("id", row.id);
  }
}

/**
 * Create a custom exercise from the routine editor's picker and add it to the
 * routine in one step — the workout flow's equivalent lives in
 * `workout/actions.ts` and returns to the logging screen instead.
 */
export async function createCustomExerciseForRoutine(formData: FormData) {
  const { supabase, user } = await requireUser();
  const routineId = requiredString(formData, "routineId");
  const name = requiredString(formData, "name");
  const muscleGroup = String(formData.get("muscleGroup") ?? "").trim() || null;

  const { data, error } = await supabase
    .from("exercises")
    .insert({ name, muscle_group: muscleGroup, is_custom: true, user_id: user.id })
    .select("id")
    .single();

  if (error) throw new Error(`Could not create exercise: ${error.message}`);

  const added = new FormData();
  added.set("routineId", routineId);
  added.set("exerciseId", data.id);
  await addRoutineExercise(added);

  redirect(`/routines/${routineId}`);
}
