"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/lift/queries";
import { getSettings } from "@/lib/settings";
import { isValidTimezone } from "@/lib/dates";
import { numberField, textField } from "@/lib/format";
import { RUN_TYPES, type RuleParams, type RuleType, type RunType, type SessionFilter } from "@/lib/conflicts";
import { getConnection, type Provider } from "@/lib/integrations/oauth";
import { revokeStrava, syncStrava } from "@/lib/integrations/strava";
import { revokeGoogle, syncGoogle } from "@/lib/integrations/google";

export async function saveSettings(formData: FormData) {
  const { supabase, user } = await requireUser();
  const timezone = textField(formData, "timezone") ?? "UTC";
  if (!isValidTimezone(timezone)) throw new Error(`Unknown timezone “${timezone}”`);
  const rest = numberField(formData, "defaultRestSeconds") ?? 90;

  const { error } = await supabase.from("user_settings").upsert({
    user_id: user.id,
    timezone,
    default_rest_seconds: Math.max(0, Math.min(3600, Math.round(rest))),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Could not save settings: ${error.message}`);
  revalidatePath("/", "layout");
}

function provider(formData: FormData): Provider {
  return String(formData.get("provider")) === "google" ? "google" : "strava";
}

export async function syncNow(formData: FormData) {
  const { supabase, user } = await requireUser();
  const p = provider(formData);
  let query: string;
  try {
    if (p === "strava") {
      const r = await syncStrava(supabase, user.id);
      query = `synced=strava&detail=${encodeURIComponent(
        `${r.total} runs since ${r.since}: ${r.matched} matched to planned runs, ${r.created} added, ${r.updated} refreshed.`,
      )}`;
    } else {
      const { timezone } = await getSettings();
      const r = await syncGoogle(supabase, user.id, timezone);
      query = `synced=google&detail=${encodeURIComponent(
        `${r.events} busy events from ${r.calendars} calendar${r.calendars === 1 ? "" : "s"}; ${r.removed} removed.`,
      )}`;
    }
  } catch (e) {
    query = `error=${p}_failed&detail=${encodeURIComponent(e instanceof Error ? e.message : "unknown")}`;
  }
  revalidatePath("/", "layout");
  redirect(`/settings?${query}#integrations`);
}

export async function disconnect(formData: FormData) {
  const { supabase, user } = await requireUser();
  const p = provider(formData);
  const conn = await getConnection(supabase, p);
  if (conn) {
    if (p === "strava") await revokeStrava(conn.access_token);
    else await revokeGoogle(conn.refresh_token ?? conn.access_token);
  }
  await supabase.from("oauth_connections").delete().eq("user_id", user.id).eq("provider", p);
  // Imported runs stay (they're training history); synced busy blocks go,
  // since nothing would keep them current any more.
  if (p === "google") await supabase.from("busy_blocks").delete().eq("user_id", user.id).eq("source", "google_calendar");
  revalidatePath("/", "layout");
}

// ---- Conflict rules --------------------------------------------------------

const RULE_TYPES: RuleType[] = ["min_hours_between", "no_back_to_back_hard", "max_days_without_rest", "busy_block_overlap"];

function list(formData: FormData, key: string): string[] {
  return String(formData.get(key) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function runTypes(formData: FormData, key: string): RunType[] {
  return formData.getAll(key).map(String).filter((t): t is RunType => RUN_TYPES.includes(t as RunType));
}

function filter(formData: FormData, side: "a" | "b"): SessionFilter {
  const type = String(formData.get(`${side}_type`)) === "run" ? "run" : "lift";
  return type === "run"
    ? { type, run_types: runTypes(formData, `${side}_run_types`) }
    : { type, focus_keywords: list(formData, `${side}_keywords`) };
}

function positive(formData: FormData, key: string, fallback: number): number {
  const n = numberField(formData, key);
  return n != null && n > 0 ? n : fallback;
}

function parseRule(formData: FormData) {
  const ruleType = String(formData.get("ruleType")) as RuleType;
  if (!RULE_TYPES.includes(ruleType)) throw new Error("Unknown rule type");

  let params: RuleParams[RuleType];
  let typeA: string | null = null;
  let typeB: string | null = null;
  switch (ruleType) {
    case "min_hours_between": {
      const p: RuleParams["min_hours_between"] = {
        hours: positive(formData, "hours", 24),
        a: filter(formData, "a"),
        b: filter(formData, "b"),
      };
      params = p;
      typeA = p.a.type;
      typeB = p.b.type;
      break;
    }
    case "no_back_to_back_hard":
      params = { hard_run_types: runTypes(formData, "hard_run_types"), hard_lift_keywords: list(formData, "hard_lift_keywords") };
      break;
    case "max_days_without_rest":
      params = { days: Math.round(positive(formData, "days", 6)) };
      break;
    case "busy_block_overlap":
      params = { default_minutes: Math.round(positive(formData, "default_minutes", 60)) };
      break;
  }

  return {
    rule_type: ruleType,
    name: textField(formData, "name"),
    enabled: formData.get("enabled") === "on",
    params,
    session_type_a: typeA,
    session_type_b: typeB,
  };
}

export async function saveConflictRule(formData: FormData) {
  const { supabase, user } = await requireUser();
  const id = textField(formData, "ruleId");
  const rule = parseRule(formData);

  const { error } = id
    ? await supabase.from("conflict_rules").update(rule).eq("id", id)
    : await supabase.from("conflict_rules").insert({ ...rule, user_id: user.id });
  if (error) throw new Error(`Could not save rule: ${error.message}`);

  revalidatePath("/", "layout");
  if (!id) redirect("/settings#rules");
}

export async function toggleConflictRule(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("ruleId"));
  const enabled = String(formData.get("enabled")) === "true";
  const { error } = await supabase.from("conflict_rules").update({ enabled }).eq("id", id);
  if (error) throw new Error(`Could not update rule: ${error.message}`);
  revalidatePath("/", "layout");
}

export async function deleteConflictRule(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("ruleId"));
  const { error } = await supabase.from("conflict_rules").delete().eq("id", id);
  if (error) throw new Error(`Could not delete rule: ${error.message}`);
  revalidatePath("/", "layout");
}
