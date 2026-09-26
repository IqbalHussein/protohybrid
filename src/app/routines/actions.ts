"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/lift/queries";
import { appendRoutineExercise } from "@/lib/lift/routines";
import { numberField, textField } from "@/lib/format";

export async function createRoutine(formData: FormData) {
  const { supabase, user } = await requireUser();
  const name = textField(formData, "name");
  if (!name) throw new Error("Routine name is required");

  const { data, error } = await supabase
    .from("routines")
    .insert({ user_id: user.id, name })
    .select("id")
    .single();
  if (error) {
    throw new Error(
      error.code === "23505" ? `You already have a routine called “${name}”.` : `Could not create routine: ${error.message}`,
    );
  }
  revalidatePath("/routines");
  redirect(`/routines/${data.id}`);
}

export async function renameRoutine(formData: FormData) {
  const { supabase } = await requireUser();
  const routineId = String(formData.get("routineId"));
  const name = textField(formData, "name");
  if (!name) throw new Error("Routine name is required");

  const { error } = await supabase.from("routines").update({ name }).eq("id", routineId);
  if (error) {
    throw new Error(
      error.code === "23505" ? `You already have a routine called “${name}”.` : `Could not rename routine: ${error.message}`,
    );
  }
  revalidatePath(`/routines/${routineId}`);
  revalidatePath("/routines");
}

export async function deleteRoutine(formData: FormData) {
  const { supabase } = await requireUser();
  const routineId = String(formData.get("routineId"));
  // sessions.routine_id is `on delete set null`, so past workouts survive.
  const { error } = await supabase.from("routines").delete().eq("id", routineId);
  if (error) throw new Error(`Could not delete routine: ${error.message}`);
  revalidatePath("/routines");
  redirect("/routines");
}

export async function addExerciseToRoutine(formData: FormData) {
  const { supabase } = await requireUser();
  const routineId = String(formData.get("routineId"));
  const exerciseId = String(formData.get("exerciseId"));
  await appendRoutineExercise(supabase, routineId, exerciseId);
  revalidatePath(`/routines/${routineId}`);
  redirect(`/routines/${routineId}`);
}

export async function updateRoutineExercise(formData: FormData) {
  const { supabase } = await requireUser();
  const routineId = String(formData.get("routineId"));
  const id = String(formData.get("id"));
  const { error } = await supabase
    .from("routine_exercises")
    .update({
      target_sets: numberField(formData, "targetSets"),
      target_reps: numberField(formData, "targetReps"),
    })
    .eq("id", id);
  if (error) throw new Error(`Could not save targets: ${error.message}`);
  revalidatePath(`/routines/${routineId}`);
}

export async function removeRoutineExercise(formData: FormData) {
  const { supabase } = await requireUser();
  const routineId = String(formData.get("routineId"));
  const id = String(formData.get("id"));
  const { error } = await supabase.from("routine_exercises").delete().eq("id", id);
  if (error) throw new Error(`Could not remove exercise: ${error.message}`);
  revalidatePath(`/routines/${routineId}`);
}

// Swap an exercise with its neighbour. (routine_id, position) is unique and
// each PostgREST call is its own transaction, so the swap parks one row on a
// temporary position first.
export async function moveRoutineExercise(formData: FormData) {
  const { supabase } = await requireUser();
  const routineId = String(formData.get("routineId"));
  const id = String(formData.get("id"));
  const direction = String(formData.get("direction")) === "up" ? -1 : 1;

  const { data: rows } = await supabase
    .from("routine_exercises")
    .select("id, position")
    .eq("routine_id", routineId)
    .order("position");
  const list = rows ?? [];
  const i = list.findIndex((r) => r.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return;

  const a = list[i];
  const b = list[j];
  await supabase.from("routine_exercises").update({ position: -1 }).eq("id", a.id);
  await supabase.from("routine_exercises").update({ position: a.position }).eq("id", b.id);
  await supabase.from("routine_exercises").update({ position: b.position }).eq("id", a.id);
  revalidatePath(`/routines/${routineId}`);
}
