import type { SupabaseClient } from "@supabase/supabase-js";
import { mondayOf, type DateString } from "@/lib/dates";

// sessions.plan_id is NOT NULL and plans is unique on (user_id,
// week_start_date), so creating or moving a session means resolving the plan
// for that date's week first.
export async function findOrCreatePlan(
  supabase: SupabaseClient,
  userId: string,
  date: DateString,
): Promise<string> {
  const weekStart = mondayOf(date);

  const { data: existing } = await supabase
    .from("plans")
    .select("id")
    .eq("user_id", userId)
    .eq("week_start_date", weekStart)
    .maybeSingle();

  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("plans")
    .upsert(
      { user_id: userId, week_start_date: weekStart },
      { onConflict: "user_id,week_start_date" },
    )
    .select("id")
    .single();

  if (error) throw new Error(`Could not create plan: ${error.message}`);
  return data.id;
}

// PostgREST caps responses (1000 rows by default on Supabase), which a full
// set history for one exercise can exceed. Pages through until exhausted.
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}
