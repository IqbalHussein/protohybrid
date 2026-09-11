"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/lift/queries";
import { mondayOf, toDateString } from "@/lib/lift/week";
import { countsAsWork, estimated1RM, setVolume } from "@/lib/lift/math";
import type { PrHit, PrRecordType, SetType } from "@/lib/lift/types";

// sessions.plan_id is NOT NULL and plans is unique on (user_id,
// week_start_date), so an ad-hoc workout can't just insert a session — it has
// to resolve this week's plan first. Ad-hoc sessions therefore still belong to
// the weekly plan and show up on the calendar.
async function findOrCreatePlanForToday() {
  const { supabase, user } = await requireUser();
  const weekStart = mondayOf(new Date());

  const { data: existing } = await supabase
    .from("plans")
    .select("id")
    .eq("user_id", user.id)
    .eq("week_start_date", weekStart)
    .maybeSingle();

  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("plans")
    .insert({ user_id: user.id, week_start_date: weekStart })
    .select("id")
    .single();

  if (error) throw new Error(`Could not create plan: ${error.message}`);
  return data.id;
}

export async function startWorkout(formData: FormData) {
  const { supabase } = await requireUser();
  const focus = String(formData.get("focus") ?? "").trim() || "general";
  const planId = await findOrCreatePlanForToday();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .insert({
      plan_id: planId,
      type: "lift",
      planned_date: toDateString(new Date()),
      status: "planned",
    })
    .select("id")
    .single();

  if (sessionError) throw new Error(`Could not start workout: ${sessionError.message}`);

  const { error: detailsError } = await supabase
    .from("lift_details")
    .insert({ session_id: session.id, focus, started_at: new Date().toISOString() });

  if (detailsError) throw new Error(`Could not start workout: ${detailsError.message}`);

  redirect(`/workout/${session.id}`);
}

export async function addSet(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = String(formData.get("sessionId"));
  const exerciseId = String(formData.get("exerciseId"));
  const setType = (String(formData.get("setType") || "working") as SetType);

  const num = (key: string) => {
    const raw = String(formData.get(key) ?? "").trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

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
    weight: num("weight"),
    reps: num("reps"),
    rpe: num("rpe"),
    set_type: setType,
  });

  if (error) throw new Error(`Could not log set: ${error.message}`);
  revalidatePath(`/workout/${sessionId}`);
}

export async function deleteSet(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = String(formData.get("sessionId"));
  const setId = String(formData.get("setId"));

  const { error } = await supabase.from("lift_sets").delete().eq("id", setId);
  if (error) throw new Error(`Could not delete set: ${error.message}`);
  revalidatePath(`/workout/${sessionId}`);
}

export async function addExerciseToWorkout(formData: FormData) {
  // An exercise joins a workout by logging its first set, so this just
  // bounces back with the exercise pinned open on the logging screen.
  const sessionId = String(formData.get("sessionId"));
  const exerciseId = String(formData.get("exerciseId"));
  redirect(`/workout/${sessionId}?add=${exerciseId}`);
}

export async function createCustomExercise(formData: FormData) {
  const { supabase, user } = await requireUser();
  const sessionId = String(formData.get("sessionId"));
  const name = String(formData.get("name") ?? "").trim();
  const muscleGroup = String(formData.get("muscleGroup") ?? "").trim() || null;

  if (!name) throw new Error("Exercise name is required");

  const { data, error } = await supabase
    .from("exercises")
    .insert({ name, muscle_group: muscleGroup, is_custom: true, user_id: user.id })
    .select("id")
    .single();

  if (error) throw new Error(`Could not create exercise: ${error.message}`);
  redirect(`/workout/${sessionId}?add=${data.id}`);
}

/**
 * PR detection, run on finish. Compares each working set in this session
 * against every prior set for that exercise. Warm-ups are skipped entirely:
 * they are neither PR-eligible nor counted toward volume.
 */
async function detectPrs(sessionId: string): Promise<PrHit[]> {
  const { supabase, user } = await requireUser();

  const { data: sets } = await supabase
    .from("lift_sets")
    .select("exercise_id, weight, reps, set_type, exercises(name)")
    .eq("lift_details_id", sessionId);

  const working = (sets ?? []).filter((s) => countsAsWork(s.set_type as SetType));
  if (!working.length) return [];

  const exerciseIds = [...new Set(working.map((s) => s.exercise_id))];

  const { data: prior } = await supabase
    .from("lift_sets")
    .select("exercise_id, weight, reps, set_type")
    .in("exercise_id", exerciseIds)
    .neq("lift_details_id", sessionId);

  const priorWorking = (prior ?? []).filter((s) => countsAsWork(s.set_type as SetType));

  const bestPrior = (exerciseId: string, fn: (s: { weight: number | null; reps: number | null }) => number) =>
    priorWorking
      .filter((s) => s.exercise_id === exerciseId)
      .reduce((max, s) => Math.max(max, fn(s)), 0);

  const hits: PrHit[] = [];
  const record = (
    exerciseId: string,
    name: string,
    type: PrRecordType,
    value: number,
    weight: number | null,
    reps: number | null,
  ) => {
    const dup = hits.find((h) => h.exercise_id === exerciseId && h.record_type === type);
    if (dup) {
      if (value > dup.value) Object.assign(dup, { value, weight, reps });
      return;
    }
    hits.push({ exercise_id: exerciseId, exercise_name: name, record_type: type, value, weight, reps });
  };

  for (const s of working) {
    const ex = Array.isArray(s.exercises) ? s.exercises[0] : s.exercises;
    const name = (ex as { name?: string } | null)?.name ?? "Exercise";
    const weight = s.weight as number | null;
    const reps = s.reps as number | null;
    if (weight == null || reps == null) continue;

    if (weight > bestPrior(s.exercise_id, (p) => p.weight ?? 0)) {
      record(s.exercise_id, name, "heaviest_weight", weight, weight, reps);
    }
    const e1rm = estimated1RM(weight, reps);
    if (e1rm > bestPrior(s.exercise_id, (p) => estimated1RM(p.weight, p.reps))) {
      record(s.exercise_id, name, "best_e1rm", e1rm, weight, reps);
    }
    const volume = setVolume(weight, reps);
    if (volume > bestPrior(s.exercise_id, (p) => setVolume(p.weight, p.reps))) {
      record(s.exercise_id, name, "best_volume", volume, weight, reps);
    }
    // Most reps is only meaningful compared against the same weight.
    const priorRepsAtWeight = priorWorking
      .filter((p) => p.exercise_id === s.exercise_id && p.weight === weight)
      .reduce((max, p) => Math.max(max, p.reps ?? 0), 0);
    if (priorRepsAtWeight > 0 && reps > priorRepsAtWeight) {
      record(s.exercise_id, name, "most_reps", reps, weight, reps);
    }
  }

  if (hits.length) {
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

  return hits;
}

export async function finishWorkout(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = String(formData.get("sessionId"));

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

  redirect(`/workout/${sessionId}/summary`);
}
