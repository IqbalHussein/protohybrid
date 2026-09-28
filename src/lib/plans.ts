import type { UserClient } from "./auth";
import { mondayOf } from "./week";

/**
 * `sessions.plan_id` is NOT NULL and `plans` is unique on
 * (user_id, week_start_date), so every session has to resolve to exactly one
 * week's plan before it can be written — and a session that moves across a
 * week boundary has to be reparented, or its date falls outside its own plan's
 * week and quietly corrupts every query that reaches sessions through plan_id.
 *
 * Both rules live here so the logger and the calendar cannot drift apart.
 */

/** The plan for a date's week, or null. Never writes — browsing empty weeks must leave no trace. */
export async function findPlanForDate(
  supabase: UserClient,
  userId: string,
  date: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("plans")
    .select("id")
    .eq("user_id", userId)
    .eq("week_start_date", mondayOf(date))
    .maybeSingle();

  return (data?.id as string | undefined) ?? null;
}

/** The plan for a date's week, creating it if this is the week's first write. */
export async function findOrCreatePlanForDate(
  supabase: UserClient,
  userId: string,
  date: string,
): Promise<string> {
  const existing = await findPlanForDate(supabase, userId, date);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("plans")
    .insert({ user_id: userId, week_start_date: mondayOf(date) })
    .select("id")
    .single();

  // Two concurrent writes into a fresh week race on the unique constraint;
  // 23505 means the other one won, and its plan is the one we wanted.
  if (error?.code === "23505") {
    const raced = await findPlanForDate(supabase, userId, date);
    if (raced) return raced;
  }
  if (error) throw new Error(`Could not create plan: ${error.message}`);

  return data.id as string;
}
