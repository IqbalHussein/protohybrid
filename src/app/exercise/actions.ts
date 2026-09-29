"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { optionalString, requiredString } from "@/lib/forms";

/**
 * Editing and deleting the user's own exercises. Built-ins are shared by
 * everyone and RLS refuses writes to them, but the checks here say so plainly
 * instead of surfacing a policy error.
 */

async function ownCustomExercise(exerciseId: string) {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("exercises")
    .select("id, is_custom")
    .eq("id", exerciseId)
    .maybeSingle();
  if (!data) throw new Error("Exercise not found");
  if (!data.is_custom) throw new Error("Built-in exercises can't be changed");
  return supabase;
}

export async function updateCustomExercise(formData: FormData) {
  const exerciseId = requiredString(formData, "exerciseId");
  const supabase = await ownCustomExercise(exerciseId);

  const { error } = await supabase
    .from("exercises")
    .update({ name: requiredString(formData, "name"), muscle_group: optionalString(formData, "muscleGroup") })
    .eq("id", exerciseId);
  if (error) {
    // exercises_custom_name_key: names are unique per user, case-insensitively.
    if (error.code === "23505") throw new Error("You already have an exercise with that name");
    throw new Error(`Could not save exercise: ${error.message}`);
  }

  // The name shows up in workouts, history and routines, not just here.
  revalidatePath("/", "layout");
}

/**
 * Delete a custom exercise that nothing refers to. Logged sets and routine
 * entries hold it with ON DELETE RESTRICT on purpose: deleting it would mean
 * deleting training history, so those have to go first, by the user's hand.
 */
export async function deleteCustomExercise(formData: FormData) {
  const exerciseId = requiredString(formData, "exerciseId");
  const supabase = await ownCustomExercise(exerciseId);

  const [{ count: sets }, { count: routines }] = await Promise.all([
    supabase.from("lift_sets").select("id", { count: "exact", head: true }).eq("exercise_id", exerciseId),
    supabase.from("routine_exercises").select("id", { count: "exact", head: true }).eq("exercise_id", exerciseId),
  ]);
  if (sets) {
    throw new Error(`This exercise has ${sets} logged ${sets === 1 ? "set" : "sets"}. Remove it from those workouts first.`);
  }
  if (routines) {
    throw new Error(`This exercise is in ${routines} ${routines === 1 ? "routine" : "routines"}. Remove it from them first.`);
  }

  const { error } = await supabase.from("exercises").delete().eq("id", exerciseId);
  if (error) throw new Error(`Could not delete exercise: ${error.message}`);

  revalidatePath("/", "layout");
  redirect("/");
}
