import { requireUser, type UserClient } from "@/lib/auth";
import type { HistorySet } from "./stats";
import type { Exercise, LiftSet, Routine, RoutineExercise } from "./types";

// Every query here runs as the signed-in user with RLS enforced, so none of
// them filter by user_id explicitly — the policies in 0001/0002/0005 do it.

/** Columns of lift_sets that make up a LiftSet, as one PostgREST select list. */
const SET_COLUMNS =
  "id, lift_details_id, exercise_id, set_number, reps, weight, rpe, set_type, superset_group, created_at";

const EXERCISE_COLUMNS = "id, name, muscle_group, equipment, is_custom";

/** PostgREST types a to-one embed as an array; collapse it. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export type WorkoutExercise = {
  exercise: Exercise;
  sets: LiftSet[];
  /** Shared by every exercise in the same superset; null when logged alone. */
  supersetGroup: string | null;
};

export type Workout = {
  sessionId: string;
  status: string;
  plannedDate: string;
  routineId: string | null;
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
    .select("id, status, planned_date, routine_id, lift_details(focus, notes, started_at, completed_at)")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) return null;
  const details = one(session.lift_details);
  if (!details) return null;

  const { data: sets } = await supabase
    .from("lift_sets")
    .select(`${SET_COLUMNS}, exercises(${EXERCISE_COLUMNS})`)
    .eq("lift_details_id", sessionId)
    .order("created_at", { ascending: true });

  // Group sets by exercise, ordered by when each exercise was first logged —
  // which is why 0004 added lift_sets.created_at.
  const byExercise = new Map<string, WorkoutExercise>();
  for (const row of sets ?? []) {
    const exercise = one(row.exercises) as Exercise | null;
    if (!exercise) continue;
    if (!byExercise.has(exercise.id)) {
      byExercise.set(exercise.id, { exercise, sets: [], supersetGroup: row.superset_group });
    }
    const set = { ...row } as Record<string, unknown>;
    delete set.exercises;
    byExercise.get(exercise.id)!.sets.push(set as unknown as LiftSet);
  }

  return {
    sessionId: session.id,
    status: session.status,
    plannedDate: session.planned_date,
    routineId: session.routine_id,
    focus: details.focus,
    notes: details.notes,
    startedAt: details.started_at,
    completedAt: details.completed_at,
    exercises: [...byExercise.values()],
  };
}

export async function getExercise(exerciseId: string): Promise<Exercise | null> {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("exercises")
    .select(EXERCISE_COLUMNS)
    .eq("id", exerciseId)
    .maybeSingle();
  return (data as Exercise | null) ?? null;
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
    .select(SET_COLUMNS)
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

/**
 * Per-exercise rest lengths. Only overrides are stored, so exercises without a
 * row are simply absent from the map and the caller falls back to
 * DEFAULT_REST_SECONDS.
 */
export async function getRestPreferences(exerciseIds: string[]): Promise<Map<string, number>> {
  if (!exerciseIds.length) return new Map();
  const { supabase } = await requireUser();

  const { data } = await supabase
    .from("exercise_rest_prefs")
    .select("exercise_id, rest_seconds")
    .in("exercise_id", exerciseIds);

  return new Map((data ?? []).map((r) => [r.exercise_id as string, r.rest_seconds as number]));
}

export async function searchExercises(
  query: string,
  muscleGroup?: string,
  equipment?: string,
): Promise<Exercise[]> {
  const { supabase } = await requireUser();

  let q = supabase.from("exercises").select(EXERCISE_COLUMNS);

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

export type HistoryWorkout = {
  sessionId: string;
  date: string;
  routineId: string | null;
  focus: string;
  startedAt: string | null;
  completedAt: string | null;
  exercises: { name: string; sets: LiftSet[] }[];
};

/**
 * Completed workouts, newest first, each carrying its sets so the history list
 * can expand in place (spec flow #6) without a request per row.
 *
 * Two queries rather than one nested select: sets are fetched by session id,
 * which keeps the payload flat and the ordering explicit.
 */
export async function getWorkoutHistory(limit = 25): Promise<HistoryWorkout[]> {
  const { supabase } = await requireUser();

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, planned_date, routine_id, lift_details!inner(focus, started_at, completed_at)")
    .eq("type", "lift")
    .eq("status", "completed")
    .order("planned_date", { ascending: false })
    .limit(limit);

  if (!sessions?.length) return [];
  const ids = sessions.map((s) => s.id as string);

  const { data: sets } = await supabase
    .from("lift_sets")
    .select(`${SET_COLUMNS}, exercises(id, name)`)
    .in("lift_details_id", ids)
    .order("created_at", { ascending: true });

  // session id -> exercise name -> sets, preserving first-logged order.
  const bySession = new Map<string, Map<string, { name: string; sets: LiftSet[] }>>();
  for (const row of sets ?? []) {
    const exercise = one(row.exercises) as { id: string; name: string } | null;
    if (!exercise) continue;
    const group = bySession.get(row.lift_details_id) ?? new Map();
    bySession.set(row.lift_details_id, group);
    if (!group.has(exercise.id)) group.set(exercise.id, { name: exercise.name, sets: [] });
    const set = { ...row } as Record<string, unknown>;
    delete set.exercises;
    group.get(exercise.id)!.sets.push(set as unknown as LiftSet);
  }

  return sessions.map((s) => {
    const details = one(s.lift_details);
    return {
      sessionId: s.id,
      date: s.planned_date,
      routineId: s.routine_id,
      focus: details?.focus ?? "Workout",
      startedAt: details?.started_at ?? null,
      completedAt: details?.completed_at ?? null,
      exercises: [...(bySession.get(s.id)?.values() ?? [])],
    };
  });
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

/**
 * Attach each set's session date, the shape `sessionStats` aggregates.
 *
 * lift_sets knows only its lift_details_id, so the dates come from a second
 * lookup against sessions. Sets whose session is missing (which RLS makes
 * impossible in practice) are dropped rather than dated with a guess.
 */
async function withSessionDates(
  supabase: UserClient,
  rows: {
    lift_details_id: string;
    exercise_id: string;
    weight: number | null;
    reps: number | null;
    set_type: HistorySet["set_type"];
  }[],
): Promise<HistorySet[]> {
  if (!rows.length) return [];

  const ids = [...new Set(rows.map((r) => r.lift_details_id))];
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, planned_date")
    .in("id", ids)
    .eq("status", "completed");

  const dates = new Map((sessions ?? []).map((s) => [s.id as string, s.planned_date as string]));

  return rows
    .filter((r) => dates.has(r.lift_details_id))
    .map((r) => ({ ...r, session_date: dates.get(r.lift_details_id)! }));
}

/** Every completed set of one exercise, dated — the input to its progress charts. */
export async function getExerciseHistory(exerciseId: string): Promise<HistorySet[]> {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("lift_sets")
    .select("lift_details_id, exercise_id, weight, reps, set_type")
    .eq("exercise_id", exerciseId);
  return withSessionDates(supabase, data ?? []);
}

export async function getExercisePrs(exerciseId: string) {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("personal_records")
    .select("id, record_type, value, weight, reps, achieved_at, session_id")
    .eq("exercise_id", exerciseId)
    .order("achieved_at", { ascending: false });
  return data ?? [];
}

export async function getRoutines(): Promise<(Routine & { exerciseCount: number })[]> {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("routines")
    .select("id, name, created_at, routine_exercises(id)")
    .order("name");

  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    created_at: r.created_at,
    exerciseCount: Array.isArray(r.routine_exercises) ? r.routine_exercises.length : 0,
  }));
}

export async function getRoutine(
  routineId: string,
): Promise<{ routine: Routine; exercises: RoutineExercise[] } | null> {
  const { supabase } = await requireUser();

  const { data: routine } = await supabase
    .from("routines")
    .select("id, name, created_at")
    .eq("id", routineId)
    .maybeSingle();
  if (!routine) return null;

  const { data: rows } = await supabase
    .from("routine_exercises")
    .select(`id, routine_id, exercise_id, target_sets, target_reps, position, exercises(${EXERCISE_COLUMNS})`)
    .eq("routine_id", routineId)
    .order("position");

  const exercises: RoutineExercise[] = [];
  for (const row of rows ?? []) {
    const exercise = one(row.exercises) as Exercise | null;
    if (!exercise) continue;
    exercises.push({
      id: row.id,
      routine_id: row.routine_id,
      exercise_id: row.exercise_id,
      target_sets: row.target_sets,
      target_reps: row.target_reps,
      position: row.position,
      exercise,
    });
  }

  return { routine: routine as Routine, exercises };
}

/**
 * Every completed set logged in a session started from this routine (spec
 * Screens #6). sessions.routine_id — added in 0002 — is what makes this
 * groupable; without it a routine's history would be unrecoverable.
 */
export async function getRoutineHistory(routineId: string): Promise<HistorySet[]> {
  const { supabase } = await requireUser();

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id")
    .eq("routine_id", routineId)
    .eq("status", "completed");

  const ids = (sessions ?? []).map((s) => s.id as string);
  if (!ids.length) return [];

  const { data } = await supabase
    .from("lift_sets")
    .select("lift_details_id, exercise_id, weight, reps, set_type")
    .in("lift_details_id", ids);

  return withSessionDates(supabase, data ?? []);
}
