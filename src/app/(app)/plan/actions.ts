"use server";

// Plan builder actions. saveProfile validates with the planner's own
// validateProfile so the messages match the planner's rules; acceptPlan
// regenerates the block on the server (never trusting client-sent sessions) and
// writes it through the accept_training_block RPC.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/lifts";
import { generatePlan, validateProfile, type ProfileInput } from "@/lib/planner";
import { getTimeZone } from "@/lib/settings";
import { todayIn } from "@/lib/time";
import { blockStartFor, profileToRow, toAcceptSessions } from "@/lib/training-profile";
import type { RpcArgs } from "@/lib/types";
import type { ActionState } from "@/components/ui/form-message";
import { loadProfile } from "./data";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function saveProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let input: ProfileInput;
  try {
    const parsed: unknown = JSON.parse(text(formData, "payload"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    input = parsed as ProfileInput;
  } catch {
    return { error: "Your answers couldn't be read. Reload the page and try again." };
  }

  const result = validateProfile(input);
  if (!result.ok) return { error: result.error };

  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("training_profiles")
    .upsert({ ...profileToRow(user.id, result.value), updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return { error: `Profile not saved: ${error.message}` };

  revalidatePath("/plan");
  redirect("/plan?preview=1");
}

export async function acceptPlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const start = text(formData, "start");
  if (start !== "this" && start !== "next") return { error: "Choose when the plan starts." };
  const allowSameDay = formData.get("allow_same_day") === "on";

  const { supabase, user } = await requireUser();
  let profile;
  try {
    profile = await loadProfile(supabase, user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't load your profile." };
  }
  if (!profile) return { error: "Set up your profile first." };

  const today = todayIn(await getTimeZone());
  const startDate = blockStartFor(today, start);

  let block;
  try {
    block = generatePlan(profile, { startDate });
  } catch (e) {
    return { error: `Couldn't build a plan: ${e instanceof Error ? e.message : "unknown error"}` };
  }

  const sessions = toAcceptSessions(block, start === "this" ? today : undefined);
  if (sessions.length === 0) return { error: "Nothing is left to plan this week. Start next Monday instead." };

  const args: RpcArgs["accept_training_block"] = {
    p_start_date: block.startDate,
    p_weeks: block.weeks.length,
    p_today: today,
    p_profile: profile as unknown as Record<string, unknown>,
    p_relaxations: block.relaxations,
    p_summary: block.summary,
    p_generator_version: block.generatorVersion,
    p_sessions: sessions,
    p_allow_same_day_hard: allowSameDay,
  };
  const { error } = await supabase.rpc("accept_training_block", args);
  if (error) return { error: `Plan not saved: ${error.message}` };

  for (const path of ["/plan", "/week", "/runs", "/lifts"]) revalidatePath(path);
  redirect("/plan");
}

export async function swapSessions(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const a = text(formData, "session_a");
  const b = text(formData, "session_b");
  if (!isUuid(a) || !isUuid(b)) return { error: "Pick a session to swap with." };
  if (a === b) return { error: "Pick a different session to swap with." };

  const { supabase } = await requireUser();
  const args: RpcArgs["swap_sessions"] = { p_session_a: a, p_session_b: b };
  const { error } = await supabase.rpc("swap_sessions", args);
  if (error) return { error: `Sessions not swapped: ${error.message}` };

  for (const path of ["/plan", "/week", "/runs", "/lifts"]) revalidatePath(path);
  return { ok: true, message: "Sessions swapped." };
}
