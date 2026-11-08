import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { UserSettings, WeightUnit } from "./types";
import { TZ_COOKIE, resolveTimeZone } from "./time";

// Returns the user's settings row, creating it with defaults if missing.
export async function getUserSettings(supabase: SupabaseClient, userId: string): Promise<UserSettings> {
  const { data } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle<UserSettings>();
  if (data) return data;

  await supabase
    .from("user_settings")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  const { data: created, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .single<UserSettings>();
  if (error || !created) {
    throw new Error(`Couldn't load settings: ${error?.message ?? "no row"}`);
  }
  return created;
}

export async function getWeightUnit(supabase: SupabaseClient, userId: string): Promise<WeightUnit> {
  return (await getUserSettings(supabase, userId)).weight_unit;
}

// The user's IANA timezone from the tz cookie (UTC until the browser sets it).
export async function getTimeZone(): Promise<string> {
  return resolveTimeZone((await cookies()).get(TZ_COOKIE)?.value);
}

// Seeds the default conflict rules once. Reads the seeded flag first so the
// write-path RPC (which locks the settings row) only runs when needed.
// Returns an error message, or null.
export async function ensureDefaultConflictRules(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase
    .from("user_settings")
    .select("conflict_rules_seeded")
    .maybeSingle<Pick<UserSettings, "conflict_rules_seeded">>();
  if (data?.conflict_rules_seeded) return null;
  const { error } = await supabase.rpc("seed_default_conflict_rules");
  return error?.message ?? null;
}
