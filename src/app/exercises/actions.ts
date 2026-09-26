"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/lift/queries";
import { textField } from "@/lib/format";

export async function updateCustomExercise(formData: FormData) {
  const { supabase } = await requireUser();
  const exerciseId = String(formData.get("exerciseId"));
  const name = textField(formData, "name");
  if (!name) throw new Error("Exercise name is required");

  const { error } = await supabase
    .from("exercises")
    .update({ name, muscle_group: textField(formData, "muscleGroup"), equipment: textField(formData, "equipment") })
    .eq("id", exerciseId);
  if (error) {
    throw new Error(error.code === "23505" ? `You already have an exercise called “${name}”.` : error.message);
  }
  revalidatePath(`/exercises/${exerciseId}`);
}

export async function deleteCustomExercise(formData: FormData) {
  const { supabase } = await requireUser();
  const exerciseId = String(formData.get("exerciseId"));
  const { error } = await supabase.from("exercises").delete().eq("id", exerciseId);
  if (error) {
    // lift_sets and routine_exercises reference exercises `on delete restrict`.
    throw new Error(
      error.code === "23503"
        ? "This exercise has logged sets or is in a routine, so it can't be deleted. Remove those first."
        : error.message,
    );
  }
  revalidatePath("/exercises");
  redirect("/exercises");
}
