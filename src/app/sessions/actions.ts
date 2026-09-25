"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/lift/queries";
import { rebuildPrs } from "@/lib/lift/prs";
import { findOrCreatePlan } from "@/lib/plans";
import { getSettings } from "@/lib/settings";
import { RUN_TYPES, type RunType } from "@/lib/conflicts";
import { addDays, isDateString, mondayOf, zonedToUtc } from "@/lib/dates";
import { numberField, parseClock, textField } from "@/lib/format";

function dateField(formData: FormData, key = "date"): string {
  const raw = String(formData.get(key) ?? "");
  if (!isDateString(raw)) throw new Error("A valid date is required");
  return raw;
}

function timeField(formData: FormData, key = "time"): string | null {
  const raw = String(formData.get(key) ?? "").trim();
  return /^\d{2}:\d{2}$/.test(raw) ? raw : null;
}

function runTypeField(formData: FormData): RunType {
  const raw = String(formData.get("runType") ?? "easy");
  return RUN_TYPES.includes(raw as RunType) ? (raw as RunType) : "easy";
}

function runTargets(formData: FormData) {
  return {
    run_type: runTypeField(formData),
    target_distance_km: numberField(formData, "targetDistance"),
    target_pace_sec_per_km: parseClock(String(formData.get("targetPace") ?? "")),
    target_duration_sec: parseClock(String(formData.get("targetDuration") ?? "")),
  };
}

function revalidateCalendar() {
  revalidatePath("/", "layout");
}

export async function createSession(formData: FormData) {
  const { supabase, user } = await requireUser();
  const type = String(formData.get("type")) === "run" ? "run" : "lift";
  const date = dateField(formData);
  const planId = await findOrCreatePlan(supabase, user.id, date);
  const routineId = type === "lift" ? textField(formData, "routineId") : null;

  const { data: session, error } = await supabase
    .from("sessions")
    .insert({
      plan_id: planId,
      type,
      planned_date: date,
      planned_time: timeField(formData),
      status: "planned",
      notes: textField(formData, "notes"),
      routine_id: routineId,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create session: ${error.message}`);

  if (type === "run") {
    const { error: e } = await supabase.from("run_details").insert({ session_id: session.id, ...runTargets(formData) });
    if (e) throw new Error(`Could not create run: ${e.message}`);
  } else {
    let focus = textField(formData, "focus");
    if (!focus && routineId) {
      const { data } = await supabase.from("routines").select("name").eq("id", routineId).maybeSingle();
      focus = data?.name ?? null;
    }
    const { error: e } = await supabase.from("lift_details").insert({ session_id: session.id, focus: focus ?? "general" });
    if (e) throw new Error(`Could not create lift: ${e.message}`);
  }

  revalidateCalendar();
  redirect(`/calendar?week=${mondayOf(date)}`);
}

async function moveTo(sessionId: string, date: string) {
  const { supabase, user } = await requireUser();
  const planId = await findOrCreatePlan(supabase, user.id, date);
  const { error } = await supabase
    .from("sessions")
    .update({ planned_date: date, plan_id: planId })
    .eq("id", sessionId);
  if (error) throw new Error(`Could not move session: ${error.message}`);
}

// Drag-to-reschedule on the calendar.
export async function moveSession(sessionId: string, date: string) {
  if (!isDateString(date)) throw new Error("Invalid date");
  await moveTo(sessionId, date);
  revalidateCalendar();
}

export async function updateSession(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = String(formData.get("sessionId"));
  const date = dateField(formData);

  const { data: current } = await supabase.from("sessions").select("type, planned_date").eq("id", sessionId).single();
  if (!current) throw new Error("Session not found");
  if (current.planned_date !== date) await moveTo(sessionId, date);

  const routineId = current.type === "lift" ? textField(formData, "routineId") : null;
  const { error } = await supabase
    .from("sessions")
    .update({ planned_time: timeField(formData), notes: textField(formData, "notes"), routine_id: routineId })
    .eq("id", sessionId);
  if (error) throw new Error(`Could not save session: ${error.message}`);

  if (current.type === "run") {
    const { error: e } = await supabase.from("run_details").update(runTargets(formData)).eq("session_id", sessionId);
    if (e) throw new Error(`Could not save run: ${e.message}`);
  } else {
    const { error: e } = await supabase
      .from("lift_details")
      .update({ focus: textField(formData, "focus") ?? "general" })
      .eq("session_id", sessionId);
    if (e) throw new Error(`Could not save lift: ${e.message}`);
  }

  revalidateCalendar();
  redirect(`/sessions/${sessionId}`);
}

export async function setSessionStatus(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = String(formData.get("sessionId"));
  const status = String(formData.get("status"));
  if (!["planned", "completed", "skipped"].includes(status)) throw new Error("Invalid status");

  const { error } = await supabase.from("sessions").update({ status }).eq("id", sessionId);
  if (error) throw new Error(`Could not update session: ${error.message}`);
  revalidateCalendar();
}

// Manual actuals for a run, for when Strava isn't connected or missed one.
export async function logRunActual(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = String(formData.get("sessionId"));
  const distance = numberField(formData, "actualDistance");
  const duration = parseClock(String(formData.get("actualDuration") ?? ""));
  const pace = distance && duration ? Math.round(duration / distance) : null;

  const { error } = await supabase
    .from("run_details")
    .update({
      actual_distance_km: distance,
      actual_duration_sec: duration,
      actual_pace_sec_per_km: pace,
      actual_avg_hr: numberField(formData, "actualHr"),
      actual_elevation_m: numberField(formData, "actualElevation"),
    })
    .eq("session_id", sessionId);
  if (error) throw new Error(`Could not save run: ${error.message}`);

  await supabase.from("sessions").update({ status: "completed" }).eq("id", sessionId);
  revalidateCalendar();
}

export async function deleteSession(formData: FormData) {
  const { supabase, user } = await requireUser();
  const sessionId = String(formData.get("sessionId"));
  const { data } = await supabase.from("sessions").select("planned_date").eq("id", sessionId).maybeSingle();
  const { data: sets } = await supabase.from("lift_sets").select("exercise_id").eq("lift_details_id", sessionId);
  const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
  if (error) throw new Error(`Could not delete session: ${error.message}`);
  // Later sessions' PRs may have been measured against this one.
  await rebuildPrs(supabase, user.id, (sets ?? []).map((s) => s.exercise_id));
  revalidateCalendar();
  redirect(data ? `/calendar?week=${mondayOf(data.planned_date)}` : "/calendar");
}

export async function addBusyBlock(formData: FormData) {
  const { supabase, user } = await requireUser();
  const { timezone } = await getSettings();
  const date = dateField(formData);
  const start = timeField(formData, "start");
  const end = timeField(formData, "end");
  const title = textField(formData, "title") ?? "Busy";
  if (!start || !end) throw new Error("Start and end times are required");

  // An end time before the start means the block runs past midnight.
  const endDate = end <= start ? addDays(date, 1) : date;
  const { error } = await supabase.from("busy_blocks").insert({
    user_id: user.id,
    title,
    start_time: zonedToUtc(date, start, timezone).toISOString(),
    end_time: zonedToUtc(endDate, end, timezone).toISOString(),
    source: "manual",
  });
  if (error) throw new Error(`Could not add busy block: ${error.message}`);
  revalidateCalendar();
}

export async function deleteBusyBlock(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id"));
  const { error } = await supabase.from("busy_blocks").delete().eq("id", id).eq("source", "manual");
  if (error) throw new Error(`Could not delete busy block: ${error.message}`);
  revalidateCalendar();
}
