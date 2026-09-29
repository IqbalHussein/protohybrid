"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { optionalNumber, optionalString, requiredString } from "@/lib/forms";
import { RULE_TYPES, type RuleParams, type RuleType, type SessionFilter } from "@/lib/calendar/conflicts";
import { RUN_TYPES, type RunType } from "@/lib/calendar/types";
import { getConnection, type Provider } from "@/lib/integrations/oauth";
import { revokeStrava, syncStrava } from "@/lib/integrations/strava";
import { revokeGoogle, syncGoogle } from "@/lib/integrations/google";

// ---- Integrations -----------------------------------------------------------

function provider(formData: FormData): Provider {
  return formData.get("provider") === "google" ? "google" : "strava";
}

/** Outcome goes back in the URL, so the page can say what happened without client state. */
export async function syncNow(formData: FormData) {
  const { supabase, user } = await requireUser();
  const p = provider(formData);

  let query: string;
  try {
    if (p === "strava") {
      const r = await syncStrava(supabase, user.id);
      query = `synced=strava&detail=${encodeURIComponent(
        `${r.runs} ${r.runs === 1 ? "run" : "runs"} since ${r.since}: ${r.matched} matched to planned runs, ${r.created} added, ${r.refreshed} refreshed.`,
      )}`;
    } else {
      const r = await syncGoogle(supabase, user.id);
      query = `synced=google&detail=${encodeURIComponent(
        `${r.events} busy ${r.events === 1 ? "event" : "events"} from ${r.calendars} ${r.calendars === 1 ? "calendar" : "calendars"}; ${r.removed} removed.`,
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

  const connection = await getConnection(supabase, user.id, p);
  if (connection) {
    if (p === "strava") await revokeStrava(connection.access_token);
    else await revokeGoogle(connection.refresh_token ?? connection.access_token);
  }
  await supabase.from("oauth_connections").delete().eq("user_id", user.id).eq("provider", p);

  // Imported runs stay: they're training history, not a mirror of Strava.
  // Synced busy blocks go, since nothing would keep them current any more.
  if (p === "google") {
    await supabase.from("busy_blocks").delete().eq("user_id", user.id).eq("source", "google_calendar");
  }

  revalidatePath("/", "layout");
  redirect("/settings#integrations");
}

// ---- Conflict rules ---------------------------------------------------------

/** "legs, lower body," -> ["legs", "lower body"] */
function keywordList(formData: FormData, key: string): string[] {
  return String(formData.get(key) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function runTypes(formData: FormData, key: string): RunType[] {
  return formData
    .getAll(key)
    .map(String)
    .filter((t): t is RunType => RUN_TYPES.includes(t as RunType));
}

function sessionFilter(formData: FormData, side: "a" | "b"): SessionFilter {
  return formData.get(`${side}_type`) === "run"
    ? { type: "run", run_types: runTypes(formData, `${side}_run_types`) }
    : { type: "lift", focus_keywords: keywordList(formData, `${side}_keywords`) };
}

/** A positive whole number, or the fallback for blank, zero or nonsense. */
function positiveInt(formData: FormData, key: string, fallback: number): number {
  const n = optionalNumber(formData, key);
  return n != null && n > 0 ? Math.round(n) : fallback;
}

function parseRule(formData: FormData) {
  const ruleType = requiredString(formData, "ruleType") as RuleType;
  if (!RULE_TYPES.includes(ruleType)) throw new Error(`Unknown rule type ${ruleType}`);

  let params: RuleParams[RuleType];
  // The 0001 columns stay filled where they mean something, so the table
  // still reads sensibly to anyone looking at it directly.
  let typeA: string | null = null;
  let typeB: string | null = null;

  switch (ruleType) {
    case "min_hours_between": {
      const p: RuleParams["min_hours_between"] = {
        hours: positiveInt(formData, "hours", 24),
        a: sessionFilter(formData, "a"),
        b: sessionFilter(formData, "b"),
      };
      params = p;
      typeA = p.a.type;
      typeB = p.b.type;
      break;
    }
    case "no_back_to_back_hard":
      params = {
        hard_run_types: runTypes(formData, "hard_run_types"),
        hard_lift_keywords: keywordList(formData, "hard_lift_keywords"),
      };
      break;
    case "max_days_without_rest":
      params = { days: positiveInt(formData, "days", 6) };
      break;
    case "busy_block_overlap":
      params = {};
      break;
  }

  return {
    rule_type: ruleType,
    name: optionalString(formData, "name"),
    enabled: formData.get("enabled") === "on",
    params,
    session_type_a: typeA,
    session_type_b: typeB,
  };
}

export async function saveConflictRule(formData: FormData) {
  const { supabase, user } = await requireUser();
  const ruleId = optionalString(formData, "ruleId");
  const rule = parseRule(formData);

  const { error } = ruleId
    ? await supabase.from("conflict_rules").update(rule).eq("id", ruleId)
    : await supabase.from("conflict_rules").insert({ ...rule, user_id: user.id });
  if (error) throw new Error(`Could not save rule: ${error.message}`);

  revalidatePath("/calendar");
  revalidatePath("/settings");
  // Clears ?newRule so the "add" form closes after adding.
  redirect("/settings#rules");
}

export async function toggleConflictRule(formData: FormData) {
  const { supabase } = await requireUser();
  const ruleId = requiredString(formData, "ruleId");
  const enabled = formData.get("enabled") === "true";

  const { error } = await supabase.from("conflict_rules").update({ enabled }).eq("id", ruleId);
  if (error) throw new Error(`Could not update rule: ${error.message}`);

  revalidatePath("/calendar");
  revalidatePath("/settings");
}

export async function deleteConflictRule(formData: FormData) {
  const { supabase } = await requireUser();
  const ruleId = requiredString(formData, "ruleId");

  const { error } = await supabase.from("conflict_rules").delete().eq("id", ruleId);
  if (error) throw new Error(`Could not delete rule: ${error.message}`);

  revalidatePath("/calendar");
  revalidatePath("/settings");
}
