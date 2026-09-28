import { cache } from "react";
import { requireUser } from "@/lib/auth";
import { DEFAULT_RULES, type ConflictRule } from "./conflicts";

/**
 * The signed-in user's conflict rules, seeding the defaults on first use.
 *
 * "User-configurable from the start" means a new user should see rules they
 * can edit, not an empty list — but deleting every rule has to stick, so the
 * seeding is recorded in `user_settings` rather than inferred from an empty
 * table. Cached per request: the calendar and the settings page both read it.
 */
export const getConflictRules = cache(async (): Promise<ConflictRule[]> => {
  const { supabase, user } = await requireUser();
  await seedDefaultRules(supabase, user.id);

  const { data, error } = await supabase
    .from("conflict_rules")
    .select("id, name, rule_type, params, enabled")
    .order("created_at");
  if (error) throw new Error(`Could not load conflict rules: ${error.message}`);
  return (data ?? []) as ConflictRule[];
});

async function seedDefaultRules(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
) {
  await supabase
    .from("user_settings")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });

  // Claim the seeding before inserting, so two first requests racing each
  // other can't both insert the defaults: only the update that flips the flag
  // gets a row back.
  const { data: claimed } = await supabase
    .from("user_settings")
    .update({ conflict_rules_seeded: true })
    .eq("user_id", userId)
    .eq("conflict_rules_seeded", false)
    .select("user_id");
  if (!claimed?.length) return;

  const { error } = await supabase.from("conflict_rules").insert(
    DEFAULT_RULES.map((rule) => ({
      user_id: userId,
      name: rule.name,
      rule_type: rule.rule_type,
      params: rule.params,
      enabled: rule.enabled,
    })),
  );
  if (error) {
    // Give the claim back so the next request tries again.
    await supabase.from("user_settings").update({ conflict_rules_seeded: false }).eq("user_id", userId);
    throw new Error(`Could not create default conflict rules: ${error.message}`);
  }
}
