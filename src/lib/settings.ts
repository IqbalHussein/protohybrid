import { cache } from "react";
import { requireUser } from "@/lib/lift/queries";
import { DEFAULT_RULES, type ConflictRule } from "@/lib/conflicts";

export type UserSettings = {
  timezone: string;
  default_rest_seconds: number;
  conflict_rules_seeded: boolean;
};

const DEFAULTS: UserSettings = {
  timezone: "UTC",
  default_rest_seconds: 90,
  conflict_rules_seeded: false,
};

// One row per user, created on first read. The first read also seeds the
// default conflict rules; the seeded flag keeps them from coming back if the
// user later deletes them all. Cached per request since most pages need the
// timezone.
export const getSettings = cache(async (): Promise<UserSettings> => {
  const { supabase, user } = await requireUser();

  const { data } = await supabase
    .from("user_settings")
    .select("timezone, default_rest_seconds, conflict_rules_seeded")
    .eq("user_id", user.id)
    .maybeSingle();

  const settings: UserSettings = data ?? DEFAULTS;
  if (!data) {
    await supabase
      .from("user_settings")
      .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
  }

  if (!settings.conflict_rules_seeded) {
    const { error } = await supabase.from("conflict_rules").insert(
      DEFAULT_RULES.map((r) => ({
        user_id: user.id,
        name: r.name,
        rule_type: r.rule_type,
        params: r.params,
        enabled: r.enabled,
      })),
    );
    if (!error) {
      await supabase
        .from("user_settings")
        .update({ conflict_rules_seeded: true })
        .eq("user_id", user.id);
      settings.conflict_rules_seeded = true;
    }
  }

  return settings;
});

export const getConflictRules = cache(async (): Promise<ConflictRule[]> => {
  const { supabase } = await requireUser();
  await getSettings(); // ensures defaults are seeded
  const { data } = await supabase
    .from("conflict_rules")
    .select("id, name, rule_type, params, enabled")
    .order("created_at");
  return (data ?? []) as ConflictRule[];
});
