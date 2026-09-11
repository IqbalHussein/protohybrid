import { createClient } from "@/lib/supabase/server";
import type { Exercise, LiftSet } from "./types";

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, user };
}

export type WorkoutExercise = {
  exercise: Exercise;
  sets: LiftSet[];
};

export type Workout = {
  sessionId: string;
  status: string;
  plannedDate: string;
  focus: string;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  exercises: WorkoutExercise[];
};

export async function getWorkout(sessionId: string): Promise<Workout | null> {
  const { supabase } = await requireUser();

  const { data: session } = await supabase
    .from("sessions")
    .select("id, status, planned_date, lift_details(focus, notes, started_at, completed_at)")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) return null;
  const details = Array.isArray(session.lift_details)
    ? session.lift_details[0]
    : session.lift_details;
  if (!details) return null;

  const { data: sets } = await supabase
    .from("lift_sets")
    .select(
      "id, lift_details_id, exercise_id, set_number, reps, weight, rpe, set_type, superset_group, created_at, exercises(id, name, muscle_group, equipment, is_custom)",
    )
    .eq("lift_details_id", sessionId)
    .order("created_at", { ascending: true });

  // Group sets by exercise, ordered by when each exercise was first logged.
  const byExercise = new Map<string, WorkoutExercise>();
  for (const row of sets ?? []) {
    const ex = (Array.isArray(row.exercises) ? row.exercises[0] : row.exercises) as Exercise;
    if (!ex) continue;
    if (!byExercise.has(ex.id)) byExercise.set(ex.id, { exercise: ex, sets: [] });
    const set = { ...row } as Record<string, unknown>;
    delete set.exercises;
    byExercise.get(ex.id)!.sets.push(set as unknown as LiftSet);
  }

  return {
    sessionId: session.id,
    status: session.status,
    plannedDate: session.planned_date,
    focus: details.focus,
    notes: details.notes,
    startedAt: details.started_at,
    completedAt: details.completed_at,
    exercises: [...byExercise.values()],
  };
}

// Previous performance for the ghost text on each new set row: the sets from
// the most recent *other* session that used this exercise.
export async function getPreviousPerformance(
  exerciseId: string,
  excludeSessionId: string,
): Promise<LiftSet[]> {
  const { supabase } = await requireUser();

  const { data } = await supabase
    .from("lift_sets")
    .select("id, lift_details_id, exercise_id, set_number, reps, weight, rpe, set_type, superset_group, created_at")
    .eq("exercise_id", exerciseId)
    .neq("lift_details_id", excludeSessionId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (!data?.length) return [];

  // Everything from whichever session is most recent.
  const mostRecent = data[0].lift_details_id;
  return (data as LiftSet[])
    .filter((s) => s.lift_details_id === mostRecent)
    .sort((a, b) => a.set_number - b.set_number);
}

export async function searchExercises(
  query: string,
  muscleGroup?: string,
  equipment?: string,
): Promise<Exercise[]> {
  const { supabase } = await requireUser();

  let q = supabase
    .from("exercises")
    .select("id, name, muscle_group, equipment, is_custom");

  // Dataset names are verbose ("Barbell Bench Press - Medium Grip"), so match
  // every whitespace-separated term anywhere in the name rather than requiring
  // one contiguous substring.
  for (const term of query.trim().split(/\s+/).filter(Boolean)) {
    q = q.ilike("name", `%${term}%`);
  }
  if (muscleGroup) q = q.eq("muscle_group", muscleGroup);
  if (equipment) {
    q = equipment === "__unspecified__" ? q.is("equipment", null) : q.eq("equipment", equipment);
  }

  const { data } = await q.order("name").limit(50);
  return (data ?? []) as Exercise[];
}

export async function getFilterOptions() {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("exercises").select("muscle_group, equipment").limit(2000);

  const muscles = new Set<string>();
  let hasUnspecifiedEquipment = false;
  const equipment = new Set<string>();
  for (const r of data ?? []) {
    if (r.muscle_group) muscles.add(r.muscle_group);
    if (r.equipment) equipment.add(r.equipment);
    else hasUnspecifiedEquipment = true;
  }
  return {
    muscles: [...muscles].sort(),
    equipment: [...equipment].sort(),
    hasUnspecifiedEquipment,
  };
}

export async function getWorkoutHistory(limit = 25) {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("sessions")
    .select("id, planned_date, status, lift_details(focus, started_at, completed_at)")
    .eq("type", "lift")
    .eq("status", "completed")
    .order("planned_date", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getActiveWorkout() {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("sessions")
    .select("id, lift_details!inner(started_at, completed_at)")
    .eq("type", "lift")
    .eq("status", "planned")
    .not("lift_details.started_at", "is", null)
    .is("lift_details.completed_at", null)
    .order("planned_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}
