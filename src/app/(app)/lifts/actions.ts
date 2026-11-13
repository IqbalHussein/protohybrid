"use server";

// Server actions follow one pattern: validate the form here (so users get
// specific messages), call a database function or RLS-guarded table, then
// revalidate the pages that show the data. Ownership is enforced by RLS and
// the database functions, not here.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getWeightUnit } from "@/lib/settings";
import { isUuid, parseLiftPayload, parseRoutinePayload } from "@/lib/lifts";
import type { ActionState } from "@/components/ui/form-message";
import type { ExerciseOption } from "./data";

function revalidateLifts(sessionId?: string) {
  revalidatePath("/lifts", "layout");
  revalidatePath("/week");
  if (sessionId) revalidatePath(`/lifts/${sessionId}`);
}

export async function logLift(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  // Convert with the unit stored server-side, never one sent by the client.
  const unit = await getWeightUnit(supabase, user.id);
  const parsed = parseLiftPayload(formData.get("payload"), unit);
  if (!parsed.ok) return { error: parsed.error };

  const { sessionId, date, focus, notes, sets } = parsed.value;
  const { data, error } = await supabase.rpc("log_lift", {
    p_session_id: sessionId,
    p_date: date,
    p_focus: focus,
    p_notes: notes,
    p_sets: sets,
  });
  if (error) return { error: `Lift not saved: ${error.message}` };

  const id = data as string;
  revalidateLifts(id);
  redirect(`/lifts/${id}`);
}

export type CreateExerciseResult = { exercise: ExerciseOption } | { error: string };

// Creates a custom exercise, or returns the visible one with the same name.
export async function createCustomExercise(rawName: string): Promise<CreateExerciseResult> {
  const name = String(rawName ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { error: "Enter an exercise name." };
  if (name.length > 100) return { error: "Exercise names must be 100 characters or fewer." };

  const { supabase, user } = await requireUser();
  // ilike narrows candidates; the exact case-insensitive match is checked here
  // because PostgREST treats * as a wildcard too.
  const pattern = name.replace(/[\\%_*]/g, "_");
  const { data: candidates } = await supabase
    .from("exercises")
    .select("id, name, muscle_group, equipment, is_custom")
    .ilike("name", pattern)
    .limit(50)
    .returns<ExerciseOption[]>();
  const existing = (candidates ?? []).find((e) => e.name.trim().toLowerCase() === name.toLowerCase());
  if (existing) return { exercise: existing };

  const { data, error } = await supabase
    .from("exercises")
    .insert({ name, is_custom: true, user_id: user.id })
    .select("id, name, muscle_group, equipment, is_custom")
    .single<ExerciseOption>();
  if (error || !data) return { error: `Exercise not created: ${error?.message ?? "unknown error"}` };
  return { exercise: data };
}

export async function saveRestPref(exerciseId: string, seconds: number): Promise<{ error?: string }> {
  if (!isUuid(exerciseId)) return { error: "Choose an exercise first." };
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 3600)
    return { error: "Rest must be a whole number of seconds from 0 to 3600." };

  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("exercise_rest_prefs")
    .upsert(
      { user_id: user.id, exercise_id: exerciseId, rest_seconds: seconds, updated_at: new Date().toISOString() },
      { onConflict: "user_id,exercise_id" },
    );
  if (error) return { error: `Rest time not saved: ${error.message}` };
  return {};
}

export async function deleteLift(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  if (!isUuid(sessionId)) return;
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("delete_session", { p_session_id: sessionId });
  if (error) throw new Error(`Lift not deleted: ${error.message}`);
  revalidateLifts();
  redirect("/lifts");
}

export async function setLiftStatus(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!isUuid(sessionId) || (status !== "planned" && status !== "skipped")) return;
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("set_session_status", { p_session_id: sessionId, p_status: status });
  if (error) throw new Error(`Lift not updated: ${error.message}`);
  revalidateLifts(sessionId);
}

export async function saveRoutine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseRoutinePayload(formData.get("payload"));
  if (!parsed.ok) return { error: parsed.error };

  const { supabase } = await requireUser();
  const { routineId, name, exercises } = parsed.value;
  const { error } = await supabase.rpc("save_routine", {
    p_routine_id: routineId,
    p_name: name,
    p_exercises: exercises,
  });
  if (error) return { error: `Routine not saved: ${error.message}` };

  revalidatePath("/lifts", "layout");
  redirect("/lifts/routines");
}

export async function deleteRoutine(formData: FormData) {
  const routineId = String(formData.get("routine_id") ?? "");
  if (!isUuid(routineId)) return;
  const { supabase } = await requireUser();
  const { error } = await supabase.from("routines").delete().eq("id", routineId);
  if (error) throw new Error(`Routine not deleted: ${error.message}`);
  revalidatePath("/lifts", "layout");
  revalidatePath("/week");
  redirect("/lifts/routines");
}
