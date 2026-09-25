"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/lift/queries";
import { rebuildPrs } from "@/lib/lift/prs";
import { appendRoutineExercise } from "@/lib/lift/routines";
import { findOrCreatePlan } from "@/lib/plans";
import { getSettings } from "@/lib/settings";
import { todayIn } from "@/lib/dates";
import { numberField, textField } from "@/lib/format";
import type { SetType } from "@/lib/lift/types";

const SET_TYPES: SetType[] = ["warmup", "working", "drop", "failure"];

function parseSetType(formData: FormData): SetType {
  const raw = String(formData.get("setType") || "working");
  return SET_TYPES.includes(raw as SetType) ? (raw as SetType) : "working";
}

async function sessionStatus(sessionId: string) {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("sessions").select("status").eq("id", sessionId).maybeSingle();
  return data?.status as string | undefined;
}

// Sets on a finished workout can be corrected after the fact; when they are,
// PRs for the affected exercise are replayed so history stays consistent.
async function afterSetChange(sessionId: string, exerciseIds: string[]) {
  const { supabase, user } = await requireUser();
  if ((await sessionStatus(sessionId)) === "completed") {
    await rebuildPrs(supabase, user.id, exerciseIds);
  }
  revalidatePath(`/workout/${sessionId}`);
  revalidatePath(`/workout/${sessionId}/summary`);
}

// Ad-hoc start (spec flow #1): creates a session dated today, optionally from a
// routine. It lands on this week's plan so it shows up on the calendar, but is
// flagged ad_hoc so conflict checks ignore it.
export async function startWorkout(formData: FormData) {
  const { supabase, user } = await requireUser();
  const { timezone } = await getSettings();
  const routineId = textField(formData, "routineId");
  let focus = textField(formData, "focus");

  if (routineId && !focus) {
    const { data } = await supabase.from("routines").select("name").eq("id", routineId).maybeSingle();
    focus = data?.name ?? null;
  }

  const today = todayIn(timezone);
  const planId = await findOrCreatePlan(supabase, user.id, today);

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .insert({
      plan_id: planId,
      type: "lift",
      planned_date: today,
      status: "planned",
      ad_hoc: true,
      routine_id: routineId,
    })
    .select("id")
    .single();

  if (sessionError) throw new Error(`Could not start workout: ${sessionError.message}`);

  const { error: detailsError } = await supabase
    .from("lift_details")
    .insert({ session_id: session.id, focus: focus ?? "general", started_at: new Date().toISOString() });

  if (detailsError) throw new Error(`Could not start workout: ${detailsError.message}`);

  redirect(`/workout/${session.id}`);
}

// "Start" on a planned lift session from the calendar.
export async function startPlannedWorkout(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = String(formData.get("sessionId"));

  const { error } = await supabase
    .from("lift_details")
    .update({ started_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .is("started_at", null);
  if (error) throw new Error(`Could not start workout: ${error.message}`);

  redirect(`/workout/${sessionId}`);
}

export async function addSet(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = String(formData.get("sessionId"));
  const exerciseId = String(formData.get("exerciseId"));

  const { data: existing } = await supabase
    .from("lift_sets")
    .select("set_number")
    .eq("lift_details_id", sessionId)
    .eq("exercise_id", exerciseId)
    .order("set_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("lift_sets").insert({
    lift_details_id: sessionId,
    exercise_id: exerciseId,
    set_number: (existing?.set_number ?? 0) + 1,
    weight: numberField(formData, "weight"),
    reps: numberField(formData, "reps"),
    rpe: numberField(formData, "rpe"),
    set_type: parseSetType(formData),
  });

  if (error) throw new Error(`Could not log set: ${error.message}`);
  await afterSetChange(sessionId, [exerciseId]);
}

export async function updateSet(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = String(formData.get("sessionId"));
  const setId = String(formData.get("setId"));

  const { data, error } = await supabase
    .from("lift_sets")
    .update({
      weight: numberField(formData, "weight"),
      reps: numberField(formData, "reps"),
      rpe: numberField(formData, "rpe"),
      set_type: parseSetType(formData),
    })
    .eq("id", setId)
    .select("exercise_id")
    .single();

  if (error) throw new Error(`Could not update set: ${error.message}`);
  await afterSetChange(sessionId, [data.exercise_id]);
}

export async function deleteSet(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = String(formData.get("sessionId"));
  const setId = String(formData.get("setId"));

  const { data: deleted, error } = await supabase
    .from("lift_sets")
    .delete()
    .eq("id", setId)
    .select("exercise_id")
    .single();
  if (error) throw new Error(`Could not delete set: ${error.message}`);

  // Close the gap so set numbers stay 1..n (ghost text matches by number).
  const { data: remaining } = await supabase
    .from("lift_sets")
    .select("id, set_number")
    .eq("lift_details_id", sessionId)
    .eq("exercise_id", deleted.exercise_id)
    .order("set_number");
  for (const [i, s] of (remaining ?? []).entries()) {
    if (s.set_number !== i + 1) {
      await supabase.from("lift_sets").update({ set_number: i + 1 }).eq("id", s.id);
    }
  }

  await afterSetChange(sessionId, [deleted.exercise_id]);
}

export async function removeExerciseFromWorkout(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = String(formData.get("sessionId"));
  const exerciseId = String(formData.get("exerciseId"));

  const { error } = await supabase
    .from("lift_sets")
    .delete()
    .eq("lift_details_id", sessionId)
    .eq("exercise_id", exerciseId);
  if (error) throw new Error(`Could not remove exercise: ${error.message}`);
  await afterSetChange(sessionId, [exerciseId]);
}

export async function addExerciseToWorkout(formData: FormData) {
  // An exercise joins a workout by logging its first set, so this just
  // bounces back with the exercise pinned open on the logging screen.
  const sessionId = String(formData.get("sessionId"));
  const exerciseId = String(formData.get("exerciseId"));
  redirect(`/workout/${sessionId}?add=${exerciseId}`);
}

// Shared by the workout and routine pickers: `sessionId` or `routineId` says
// where to send the new exercise.
export async function createCustomExercise(formData: FormData) {
  const { supabase, user } = await requireUser();
  const sessionId = textField(formData, "sessionId");
  const routineId = textField(formData, "routineId");
  const name = textField(formData, "name");
  const muscleGroup = textField(formData, "muscleGroup");
  const equipment = textField(formData, "equipment");

  if (!name) throw new Error("Exercise name is required");

  const { data, error } = await supabase
    .from("exercises")
    .insert({ name, muscle_group: muscleGroup, equipment, is_custom: true, user_id: user.id })
    .select("id")
    .single();

  if (error) {
    throw new Error(
      error.code === "23505"
        ? `You already have a custom exercise called “${name}”.`
        : `Could not create exercise: ${error.message}`,
    );
  }

  if (routineId) {
    await appendRoutineExercise(supabase, routineId, data.id);
    redirect(`/routines/${routineId}`);
  }
  redirect(sessionId ? `/workout/${sessionId}?add=${data.id}` : `/exercises/${data.id}`);
}

export async function finishWorkout(formData: FormData) {
  const { supabase, user } = await requireUser();
  const sessionId = String(formData.get("sessionId"));

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

  const { data: sets } = await supabase
    .from("lift_sets")
    .select("exercise_id")
    .eq("lift_details_id", sessionId);
  await rebuildPrs(supabase, user.id, (sets ?? []).map((s) => s.exercise_id));

  revalidatePath("/", "layout");
  redirect(`/workout/${sessionId}/summary`);
}

// Abandon an in-progress workout. An ad-hoc one disappears entirely; one
// started from a planned session goes back to being planned.
export async function discardWorkout(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = String(formData.get("sessionId"));

  const { data: session } = await supabase
    .from("sessions")
    .select("ad_hoc, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.status === "completed") redirect(`/workout/${sessionId}`);

  if (session.ad_hoc) {
    const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
    if (error) throw new Error(`Could not discard workout: ${error.message}`);
    revalidatePath("/", "layout");
    redirect("/");
  }

  await supabase.from("lift_sets").delete().eq("lift_details_id", sessionId);
  await supabase
    .from("lift_details")
    .update({ started_at: null, completed_at: null })
    .eq("session_id", sessionId);
  revalidatePath("/", "layout");
  redirect(`/sessions/${sessionId}`);
}

// Delete a logged workout outright (spec review note: edit/delete flow).
export async function deleteWorkout(formData: FormData) {
  const { supabase, user } = await requireUser();
  const sessionId = String(formData.get("sessionId"));

  const { data: sets } = await supabase
    .from("lift_sets")
    .select("exercise_id")
    .eq("lift_details_id", sessionId);

  const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
  if (error) throw new Error(`Could not delete workout: ${error.message}`);

  await rebuildPrs(supabase, user.id, (sets ?? []).map((s) => s.exercise_id));
  revalidatePath("/", "layout");
  redirect("/history");
}

export async function updateWorkoutDetails(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = String(formData.get("sessionId"));
  const { error } = await supabase
    .from("lift_details")
    .update({ focus: textField(formData, "focus") ?? "general", notes: textField(formData, "notes") })
    .eq("session_id", sessionId);
  if (error) throw new Error(`Could not save workout: ${error.message}`);
  revalidatePath(`/workout/${sessionId}`);
  revalidatePath(`/workout/${sessionId}/summary`);
}

export async function setRestSeconds(formData: FormData) {
  const { supabase, user } = await requireUser();
  const exerciseId = String(formData.get("exerciseId"));
  const seconds = numberField(formData, "restSeconds");
  const path = textField(formData, "path");

  if (seconds == null) {
    await supabase.from("exercise_preferences").delete().eq("exercise_id", exerciseId).eq("user_id", user.id);
  } else {
    const { error } = await supabase.from("exercise_preferences").upsert({
      user_id: user.id,
      exercise_id: exerciseId,
      rest_seconds: Math.max(0, Math.min(3600, Math.round(seconds))),
    });
    if (error) throw new Error(`Could not save rest timer: ${error.message}`);
  }
  if (path) revalidatePath(path);
}

// Save a workout as a routine (spec flow #7): exercise order plus set/rep
// targets, never weights. Targets come from the working sets actually done.
export async function saveWorkoutAsRoutine(formData: FormData) {
  const { supabase, user } = await requireUser();
  const sessionId = String(formData.get("sessionId"));
  const name = textField(formData, "name");
  if (!name) throw new Error("Routine name is required");

  const { data: sets } = await supabase
    .from("lift_sets")
    .select("exercise_id, reps, set_type, created_at")
    .eq("lift_details_id", sessionId)
    .order("created_at");

  const order: string[] = [];
  const stats = new Map<string, number[]>();
  for (const s of sets ?? []) {
    if (!order.includes(s.exercise_id)) order.push(s.exercise_id);
    if (s.set_type === "warmup") continue;
    stats.set(s.exercise_id, [...(stats.get(s.exercise_id) ?? []), s.reps ?? 0]);
  }

  const { data: routine, error } = await supabase
    .from("routines")
    .insert({ user_id: user.id, name })
    .select("id")
    .single();
  if (error) {
    throw new Error(
      error.code === "23505" ? `You already have a routine called “${name}”.` : `Could not save routine: ${error.message}`,
    );
  }

  const mode = (xs: number[]) => {
    const counts = new Map<number, number>();
    for (const x of xs) if (x > 0) counts.set(x, (counts.get(x) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
  };

  if (order.length) {
    const { error: exError } = await supabase.from("routine_exercises").insert(
      order.map((exerciseId, i) => {
        const reps = stats.get(exerciseId) ?? [];
        return {
          routine_id: routine.id,
          exercise_id: exerciseId,
          target_sets: reps.length || null,
          target_reps: mode(reps),
          position: i,
        };
      }),
    );
    if (exError) throw new Error(`Could not save routine: ${exError.message}`);
  }

  // Link this workout to the routine so it counts toward its progress chart.
  await supabase.from("sessions").update({ routine_id: routine.id }).eq("id", sessionId);

  revalidatePath("/routines");
  redirect(`/routines/${routine.id}`);
}
