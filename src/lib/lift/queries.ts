import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/plans";
import { countsAsWork, estimated1RM, setVolume } from "./math";
import type { Exercise, LiftSet, PrRecordType, SetType } from "./types";

// Middleware already bounces signed-out requests to /login; this covers a
// session that expires mid-request. Cached so a page and the helpers it calls
// share one auth round-trip.
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
});

export const requireUser = cache(async () => {
  const { supabase, user } = await getCurrentUser();
  if (!user) redirect("/login");
  return { supabase, user };
});

export type WorkoutExercise = {
  exercise: Exercise;
  sets: LiftSet[];
};

export type Workout = {
  sessionId: string;
  status: string;
  plannedDate: string;
  routineId: string | null;
  adHoc: boolean;
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
    .select("id, status, planned_date, routine_id, ad_hoc, lift_details(focus, notes, started_at, completed_at)")
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
    routineId: session.routine_id,
    adHoc: session.ad_hoc,
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

export type RoutineExercise = {
  id: string;
  position: number;
  target_sets: number | null;
  target_reps: number | null;
  exercise: Exercise;
};

export type Routine = { id: string; name: string; exercises: RoutineExercise[] };

export async function getRoutine(routineId: string): Promise<Routine | null> {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("routines")
    .select(
      "id, name, routine_exercises(id, position, target_sets, target_reps, exercises(id, name, muscle_group, equipment, is_custom))",
    )
    .eq("id", routineId)
    .maybeSingle();
  if (!data) return null;

  const exercises = (data.routine_exercises ?? [])
    .map((re) => ({
      id: re.id,
      position: re.position,
      target_sets: re.target_sets,
      target_reps: re.target_reps,
      exercise: (Array.isArray(re.exercises) ? re.exercises[0] : re.exercises) as Exercise,
    }))
    .filter((re) => re.exercise)
    .sort((a, b) => a.position - b.position);

  return { id: data.id, name: data.name, exercises };
}

export async function getRoutines() {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("routines")
    .select("id, name, routine_exercises(count)")
    .order("name");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    exerciseCount: (r.routine_exercises as unknown as { count: number }[])?.[0]?.count ?? 0,
  }));
}

// Rest timer length per exercise, falling back to the user's default.
export async function getRestSeconds(exerciseIds: string[]): Promise<Record<string, number>> {
  if (!exerciseIds.length) return {};
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("exercise_preferences")
    .select("exercise_id, rest_seconds")
    .in("exercise_id", exerciseIds);
  return Object.fromEntries((data ?? []).map((r) => [r.exercise_id, r.rest_seconds]));
}

export async function getExercise(exerciseId: string): Promise<(Exercise & { user_id: string | null }) | null> {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("exercises")
    .select("id, name, muscle_group, equipment, is_custom, user_id")
    .eq("id", exerciseId)
    .maybeSingle();
  return data;
}

export type SessionPoint = {
  sessionId: string;
  date: string;
  sets: LiftSet[];
  heaviest: number;
  bestE1rm: number;
  volume: number;
};

type SessionRow = {
  id: string;
  planned_date: string;
  lift_details: { completed_at: string | null } | { completed_at: string | null }[] | null;
};

// Completed lift sessions keyed by id, with a sortable completion timestamp.
async function completedLiftSessions(sessionIds?: string[]) {
  const { supabase } = await requireUser();
  const rows = await fetchAll<SessionRow>((from, to) => {
    let q = supabase
      .from("sessions")
      .select("id, planned_date, lift_details(completed_at)")
      .eq("type", "lift")
      .eq("status", "completed");
    if (sessionIds) q = q.in("id", sessionIds);
    return q.order("id").range(from, to);
  });
  return new Map(
    rows.map((s) => {
      const d = Array.isArray(s.lift_details) ? s.lift_details[0] : s.lift_details;
      return [s.id, { date: s.planned_date, at: d?.completed_at ?? `${s.planned_date}T12:00:00Z` }];
    }),
  );
}

function summarize(sessionId: string, date: string, sets: LiftSet[]): SessionPoint {
  const work = sets.filter((s) => countsAsWork(s.set_type));
  return {
    sessionId,
    date,
    sets: [...sets].sort((a, b) => a.set_number - b.set_number),
    heaviest: work.reduce((m, s) => Math.max(m, s.weight ?? 0), 0),
    bestE1rm: work.reduce((m, s) => Math.max(m, estimated1RM(s.weight, s.reps)), 0),
    volume: work.reduce((sum, s) => sum + setVolume(s.weight, s.reps), 0),
  };
}

// Every completed session that included this exercise, oldest first.
export async function getExerciseHistory(exerciseId: string): Promise<SessionPoint[]> {
  const { supabase } = await requireUser();
  const sets = await fetchAll<LiftSet>((from, to) =>
    supabase
      .from("lift_sets")
      .select("id, lift_details_id, exercise_id, set_number, reps, weight, rpe, set_type, superset_group, created_at")
      .eq("exercise_id", exerciseId)
      .order("id")
      .range(from, to),
  );
  const sessionIds = [...new Set(sets.map((s) => s.lift_details_id))];
  if (!sessionIds.length) return [];
  const sessions = await completedLiftSessions(sessionIds);

  const grouped = new Map<string, LiftSet[]>();
  for (const s of sets) {
    if (!sessions.has(s.lift_details_id)) continue;
    grouped.set(s.lift_details_id, [...(grouped.get(s.lift_details_id) ?? []), s]);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => sessions.get(a)!.at.localeCompare(sessions.get(b)!.at))
    .map(([id, ss]) => summarize(id, sessions.get(id)!.date, ss));
}

export async function getCurrentRecords(exerciseId: string) {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("personal_records")
    .select("record_type, value, weight, reps, session_id, achieved_at")
    .eq("exercise_id", exerciseId)
    .order("achieved_at", { ascending: false });
  // Records are appended as they're beaten, so the newest per type is current.
  const current = new Map<PrRecordType, NonNullable<typeof data>[number]>();
  for (const r of data ?? []) {
    if (!current.has(r.record_type)) current.set(r.record_type, r);
  }
  return current;
}

// Total working volume of every completed session started from a routine.
export async function getRoutineProgress(routineId: string) {
  const { supabase } = await requireUser();
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, planned_date, lift_details(completed_at)")
    .eq("routine_id", routineId)
    .eq("status", "completed")
    .order("planned_date");
  const ids = (sessions ?? []).map((s) => s.id);
  if (!ids.length) return [];

  const sets = await fetchAll<{ lift_details_id: string; weight: number | null; reps: number | null; set_type: SetType }>(
    (from, to) =>
      supabase
        .from("lift_sets")
        .select("lift_details_id, weight, reps, set_type")
        .in("lift_details_id", ids)
        .order("id")
        .range(from, to),
  );
  const volume = new Map<string, number>();
  for (const s of sets) {
    if (!countsAsWork(s.set_type)) continue;
    volume.set(s.lift_details_id, (volume.get(s.lift_details_id) ?? 0) + setVolume(s.weight, s.reps));
  }
  return (sessions ?? []).map((s) => ({ sessionId: s.id, date: s.planned_date, volume: volume.get(s.id) ?? 0 }));
}

// Exercises the user has actually logged, most recently used first.
export async function getLoggedExercises() {
  const { supabase } = await requireUser();
  const sets = await fetchAll<{
    exercise_id: string;
    created_at: string;
    exercises: Exercise | Exercise[] | null;
  }>((from, to) =>
    supabase
      .from("lift_sets")
      .select("exercise_id, created_at, exercises(id, name, muscle_group, equipment, is_custom)")
      .order("id")
      .range(from, to),
  );
  const byId = new Map<string, { exercise: Exercise; lastUsed: string; sets: number }>();
  for (const s of sets) {
    const ex = Array.isArray(s.exercises) ? s.exercises[0] : s.exercises;
    if (!ex) continue;
    const prev = byId.get(ex.id);
    byId.set(ex.id, {
      exercise: ex,
      lastUsed: !prev || s.created_at > prev.lastUsed ? s.created_at : prev.lastUsed,
      sets: (prev?.sets ?? 0) + 1,
    });
  }
  return [...byId.values()].sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));
}

// Sets for a batch of sessions, grouped per session then per exercise in the
// order they were logged. Used by the history list.
export async function getSetsForSessions(sessionIds: string[]) {
  if (!sessionIds.length) return new Map<string, WorkoutExercise[]>();
  const { supabase } = await requireUser();
  const rows = await fetchAll<LiftSet & { exercises: Exercise | Exercise[] | null }>((from, to) =>
    supabase
      .from("lift_sets")
      .select(
        "id, lift_details_id, exercise_id, set_number, reps, weight, rpe, set_type, superset_group, created_at, exercises(id, name, muscle_group, equipment, is_custom)",
      )
      .in("lift_details_id", sessionIds)
      .order("created_at")
      .order("id")
      .range(from, to),
  );
  const out = new Map<string, WorkoutExercise[]>();
  for (const { exercises, ...set } of rows) {
    const ex = Array.isArray(exercises) ? exercises[0] : exercises;
    if (!ex) continue;
    const list = out.get(set.lift_details_id) ?? [];
    let entry = list.find((e) => e.exercise.id === ex.id);
    if (!entry) list.push((entry = { exercise: ex, sets: [] }));
    entry.sets.push(set);
    out.set(set.lift_details_id, list);
  }
  return out;
}
