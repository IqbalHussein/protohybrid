import type { SupabaseClient } from "@supabase/supabase-js";

export async function appendRoutineExercise(
  supabase: SupabaseClient,
  routineId: string,
  exerciseId: string,
  targets: { sets?: number | null; reps?: number | null } = {},
) {
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
    target_sets: targets.sets ?? 3,
    target_reps: targets.reps ?? 8,
    position: (last?.position ?? -1) + 1,
  });
  if (error) throw new Error(`Could not add exercise to routine: ${error.message}`);
}
