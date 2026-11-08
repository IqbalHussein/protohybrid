import type { SupabaseClient } from "@supabase/supabase-js";
import type { Exercise } from "@/lib/types";

// Fields the exercise picker needs.
export type ExerciseOption = Pick<Exercise, "id" | "name" | "muscle_group" | "equipment" | "is_custom">;

const PAGE = 1000; // PostgREST's default max rows per response

// Fetches every row of a paginated query. `page(from, to)` must apply a
// stable order so pages don't overlap.
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

// Built-in exercises plus the user's custom ones (RLS scopes the customs).
export function loadExercises(supabase: SupabaseClient): Promise<ExerciseOption[]> {
  return fetchAll<ExerciseOption>((from, to) =>
    supabase
      .from("exercises")
      .select("id, name, muscle_group, equipment, is_custom")
      .order("name")
      .order("id")
      .range(from, to),
  );
}

// exercise_id -> rest seconds
export async function loadRestPrefs(supabase: SupabaseClient): Promise<Record<string, number>> {
  const rows = await fetchAll<{ exercise_id: string; rest_seconds: number }>((from, to) =>
    supabase.from("exercise_rest_prefs").select("exercise_id, rest_seconds").order("exercise_id").range(from, to),
  );
  return Object.fromEntries(rows.map((r) => [r.exercise_id, r.rest_seconds]));
}

// Exercise ids the user has logged most recently, newest first (for the
// picker's suggestions when the search box is empty).
export async function loadRecentExerciseIds(supabase: SupabaseClient, limit = 12): Promise<string[]> {
  const { data } = await supabase
    .from("lift_sets")
    .select("exercise_id, created_at")
    .order("created_at", { ascending: false })
    .limit(300);
  const seen: string[] = [];
  for (const r of data ?? []) {
    if (!seen.includes(r.exercise_id)) seen.push(r.exercise_id);
    if (seen.length >= limit) break;
  }
  return seen;
}
