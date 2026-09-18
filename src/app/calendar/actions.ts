"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, type UserClient } from "@/lib/auth";
import { optionalNumber, optionalString, requiredString } from "@/lib/forms";
import { findOrCreatePlanForDate } from "@/lib/plans";
import { minutesToTimeString, zonedToUtc } from "@/lib/time";
import { addDays, mondayOf } from "@/lib/week";
import { minutesToSeconds, paceFrom, parsePace } from "@/lib/calendar/runs";
import { RUN_TYPES, type RunType } from "@/lib/calendar/types";
import type { SessionType } from "@/lib/types";

/**
 * Every mutation the week grid makes. The grid itself is a client component so
 * cards can be dragged, but nothing is written there — drops call these, and
 * every one of them has a form-based equivalent that works with no JavaScript.
 */

/**
 * The calendar is one route whatever week it is showing, so the path is what
 * gets revalidated — `revalidatePath` keys on the route, not the query string.
 * The date is taken anyway so callers stay explicit about which week they
 * touched, and so this keeps working if weeks ever become path segments.
 */
function revalidateWeek(_date: string) {
  revalidatePath("/calendar");
  revalidatePath("/");
}

function requiredType(formData: FormData): SessionType {
  const type = String(formData.get("type") ?? "");
  if (type !== "run" && type !== "lift") throw new Error("A session is either a run or a lift");
  return type;
}

/** `run_details.run_type` is NOT NULL, so the create form cannot defer this choice. */
function requiredRunType(formData: FormData): RunType {
  const value = String(formData.get("runType") ?? "");
  if (!RUN_TYPES.includes(value as RunType)) throw new Error("Pick a run type");
  return value as RunType;
}

/** "HH:MM" from a time input, or null for an "anytime that day" session. */
function optionalTime(formData: FormData, key: string): string | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  const [hour, minute] = raw.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return minutesToTimeString(hour * 60 + minute);
}

async function writeRunDetails(supabase: UserClient, sessionId: string, formData: FormData) {
  const distance = optionalNumber(formData, "targetDistanceKm");
  const durationSec = minutesToSeconds(optionalNumber(formData, "targetDurationMin"));
  const typedPace = parsePace(String(formData.get("targetPace") ?? ""));

  const { error } = await supabase.from("run_details").upsert(
    {
      session_id: sessionId,
      run_type: requiredRunType(formData),
      target_distance_km: distance,
      target_duration_sec: durationSec,
      // A pace typed in wins; otherwise it is implied by distance and duration
      // rather than left blank on a plan that already determines it.
      target_pace_sec_per_km: typedPace ?? paceFrom(distance, durationSec),
    },
    { onConflict: "session_id" },
  );

  if (error) throw new Error(`Could not save run: ${error.message}`);
}

async function writeLiftDetails(supabase: UserClient, sessionId: string, formData: FormData) {
  const { error } = await supabase.from("lift_details").upsert(
    {
      session_id: sessionId,
      // NOT NULL in 0001, and "general" is what the ad-hoc logger uses too.
      focus: String(formData.get("focus") ?? "").trim() || "general",
      notes: optionalString(formData, "notes"),
    },
    { onConflict: "session_id" },
  );

  if (error) throw new Error(`Could not save lift: ${error.message}`);
}

export async function createSession(formData: FormData) {
  const { supabase, user } = await requireUser();
  const type = requiredType(formData);
  const date = requiredString(formData, "date");

  // Validated before anything is written: the details are a separate insert,
  // and a rejected run type after the session row exists would leave a session
  // with no details behind.
  if (type === "run") requiredRunType(formData);

  const planId = await findOrCreatePlanForDate(supabase, user.id, date);

  const { data: session, error } = await supabase
    .from("sessions")
    .insert({
      plan_id: planId,
      type,
      planned_date: date,
      status: "planned",
      planned_start_time: optionalTime(formData, "startTime"),
      planned_duration_min: optionalNumber(formData, "durationMin"),
      routine_id: type === "lift" ? optionalString(formData, "routineId") : null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Could not create session: ${error.message}`);

  if (type === "run") await writeRunDetails(supabase, session.id, formData);
  else await writeLiftDetails(supabase, session.id, formData);

  revalidateWeek(date);
  redirect(`/calendar?week=${mondayOf(date)}`);
}

/**
 * Edit a session, including moving it. Doubles as the no-JS reschedule path,
 * which is why date and time are ordinary fields here rather than drag-only.
 */
export async function updateSession(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = requiredString(formData, "sessionId");
  const date = requiredString(formData, "date");

  const { data: current } = await supabase
    .from("sessions")
    .select("type, planned_date")
    .eq("id", sessionId)
    .maybeSingle();
  if (!current) throw new Error("Session not found");

  await moveSession(sessionId, date, optionalTime(formData, "startTime"), {
    durationMin: optionalNumber(formData, "durationMin"),
    routineId: current.type === "lift" ? optionalString(formData, "routineId") : undefined,
  });

  if (current.type === "run") await writeRunDetails(supabase, sessionId, formData);
  else await writeLiftDetails(supabase, sessionId, formData);

  revalidateWeek(current.planned_date as string);
  revalidateWeek(date);
  redirect(`/calendar?week=${mondayOf(date)}`);
}

/** The drop handler behind a drag. Same write as the edit form's date and time fields. */
export async function rescheduleSession(formData: FormData) {
  const sessionId = requiredString(formData, "sessionId");
  const date = requiredString(formData, "date");

  // A drop onto the untimed strip clears the time; a drop onto a slot sets it.
  const time = String(formData.get("startTime") ?? "").trim();
  const clear = String(formData.get("clearTime") ?? "") === "1";

  const { previousDate } = await moveSession(
    sessionId,
    date,
    clear ? null : optionalTime(formData, "startTime"),
    { keepTimeWhenAbsent: !clear && !time },
  );

  revalidateWeek(previousDate);
  revalidateWeek(date);
}

/**
 * Move a session, reparenting it to the target week's plan.
 *
 * `sessions.plan_id` is NOT NULL and `plans` is unique on
 * (user_id, week_start_date). Dragging Sunday to Monday changes the session's
 * week, and updating `planned_date` alone would leave a session whose date
 * falls outside its own plan's week — which quietly corrupts every query that
 * reaches sessions through `plan_id`. So the plan is resolved on every move,
 * not only when the week visibly changes.
 */
async function moveSession(
  sessionId: string,
  date: string,
  startTime: string | null,
  options: {
    durationMin?: number | null;
    routineId?: string | null;
    /** True for a day-to-day drag, which must not silently drop a planned time. */
    keepTimeWhenAbsent?: boolean;
  } = {},
): Promise<{ previousDate: string }> {
  const { supabase, user } = await requireUser();

  const { data: current } = await supabase
    .from("sessions")
    .select("planned_date, plan_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!current) throw new Error("Session not found");

  const planId = await findOrCreatePlanForDate(supabase, user.id, date);

  const patch: Record<string, unknown> = { planned_date: date, plan_id: planId };
  if (!options.keepTimeWhenAbsent) patch.planned_start_time = startTime;
  if (options.durationMin !== undefined) patch.planned_duration_min = options.durationMin;
  if (options.routineId !== undefined) patch.routine_id = options.routineId;

  const { error } = await supabase.from("sessions").update(patch).eq("id", sessionId);
  if (error) throw new Error(`Could not move session: ${error.message}`);

  return { previousDate: current.planned_date as string };
}

/**
 * Delete a planned session.
 *
 * `lift_details` cascades from `sessions`, `lift_sets` cascades from
 * `lift_details`, and `personal_records.session_id` cascades too — so deleting
 * a completed session from here would wipe every set logged in it and the PRs
 * it set, silently. The calendar therefore deletes plans only. A logged
 * workout is deleted from its own summary screen, which names what will be
 * lost before it happens.
 */
export async function deleteSession(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = requiredString(formData, "sessionId");

  const { data: session } = await supabase
    .from("sessions")
    .select("status, planned_date, type")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) throw new Error("Session not found");

  if (session.status === "completed") {
    throw new Error(
      session.type === "lift"
        ? "This workout has been logged. Delete it from its summary, which names the sets and PRs that go with it."
        : "This run is marked complete. Mark it planned again before deleting it.",
    );
  }

  const { count } = await supabase
    .from("lift_sets")
    .select("id", { count: "exact", head: true })
    .eq("lift_details_id", sessionId);

  if (count) throw new Error(`This session has ${count} logged sets. Delete it from its workout summary.`);

  const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
  if (error) throw new Error(`Could not delete session: ${error.message}`);

  revalidateWeek(session.planned_date as string);
  redirect(`/calendar?week=${mondayOf(session.planned_date as string)}`);
}

/** Mark a session skipped, or put a skipped one back on the plan. */
export async function setSessionStatus(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = requiredString(formData, "sessionId");
  const status = requiredString(formData, "status");

  if (status !== "planned" && status !== "skipped") {
    // A lift completes by being logged and a run through completeRun, which
    // also writes its actuals; neither is a bare status flip.
    throw new Error("A session is completed by logging it, not by setting a status");
  }

  const { data: session } = await supabase
    .from("sessions")
    .select("planned_date")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) throw new Error("Session not found");

  const { error } = await supabase.from("sessions").update({ status }).eq("id", sessionId);
  if (error) throw new Error(`Could not update session: ${error.message}`);

  revalidateWeek(session.planned_date as string);
}

/**
 * Manual run completion (spec flow #4).
 *
 * Runs have no automatic completion path until Strava sync lands, so this
 * writes the same `actual_*` columns Strava will later fill — which is why
 * pace is derived here exactly as it will be then.
 */
export async function completeRun(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = requiredString(formData, "sessionId");

  const { data: session } = await supabase
    .from("sessions")
    .select("planned_date, type")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) throw new Error("Session not found");
  if (session.type !== "run") throw new Error("Only runs are completed this way");

  const distance = optionalNumber(formData, "actualDistanceKm");
  const durationSec = minutesToSeconds(optionalNumber(formData, "actualDurationMin"));

  const { error: detailsError } = await supabase
    .from("run_details")
    .update({
      actual_distance_km: distance,
      actual_duration_sec: durationSec,
      actual_pace_sec_per_km: paceFrom(distance, durationSec),
    })
    .eq("session_id", sessionId);
  if (detailsError) throw new Error(`Could not save the run: ${detailsError.message}`);

  const { error } = await supabase
    .from("sessions")
    .update({ status: "completed" })
    .eq("id", sessionId);
  if (error) throw new Error(`Could not complete the run: ${error.message}`);

  revalidateWeek(session.planned_date as string);
  redirect(`/calendar?week=${mondayOf(session.planned_date as string)}`);
}

/**
 * Open the logger on a planned lift (spec flow #6) — the handoff the logger
 * spec describes as its flow #1 but which had no entry point until now.
 *
 * The planned session may predate its `lift_details` row (it can't, in
 * practice, since the editor writes one, but a Strava-era importer or a hand-
 * written row could), so the row is created if missing rather than 404ing.
 */
export async function startPlannedLift(formData: FormData) {
  const { supabase } = await requireUser();
  const sessionId = requiredString(formData, "sessionId");

  const { data: session } = await supabase
    .from("sessions")
    .select("type, status, lift_details(started_at)")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) throw new Error("Session not found");
  if (session.type !== "lift") throw new Error("Only lift sessions open in the logger");

  const details = Array.isArray(session.lift_details) ? session.lift_details[0] : session.lift_details;

  if (!details) {
    const { error } = await supabase
      .from("lift_details")
      .insert({ session_id: sessionId, focus: "general", started_at: new Date().toISOString() });
    if (error) throw new Error(`Could not start the workout: ${error.message}`);
  } else if (!details.started_at) {
    // Resuming an already-started workout must not restart its clock.
    const { error } = await supabase
      .from("lift_details")
      .update({ started_at: new Date().toISOString() })
      .eq("session_id", sessionId);
    if (error) throw new Error(`Could not start the workout: ${error.message}`);
  }

  redirect(`/workout/${sessionId}`);
}

export async function createBusyBlock(formData: FormData) {
  const { supabase, user } = await requireUser();
  const { title, startTime, endTime, date } = readBusyBlock(formData);

  const { error } = await supabase.from("busy_blocks").insert({
    user_id: user.id,
    title,
    start_time: startTime,
    end_time: endTime,
    source: "manual",
  });

  if (error) throw new Error(`Could not save the commitment: ${error.message}`);

  revalidateWeek(date);
  redirect(`/calendar?week=${mondayOf(date)}`);
}

export async function updateBusyBlock(formData: FormData) {
  const { supabase } = await requireUser();
  const blockId = requiredString(formData, "blockId");
  const { title, startTime, endTime, date } = readBusyBlock(formData);

  // Google Calendar becomes a second writer to this table; its blocks are a
  // mirror of something else and are read-only here.
  await assertManual(supabase, blockId);

  const { error } = await supabase
    .from("busy_blocks")
    .update({ title, start_time: startTime, end_time: endTime })
    .eq("id", blockId);

  if (error) throw new Error(`Could not save the commitment: ${error.message}`);

  revalidateWeek(date);
  redirect(`/calendar?week=${mondayOf(date)}`);
}

export async function deleteBusyBlock(formData: FormData) {
  const { supabase } = await requireUser();
  const blockId = requiredString(formData, "blockId");
  const week = String(formData.get("week") ?? "").trim();

  await assertManual(supabase, blockId);

  const { error } = await supabase.from("busy_blocks").delete().eq("id", blockId);
  if (error) throw new Error(`Could not delete the commitment: ${error.message}`);

  revalidatePath("/calendar");
  redirect(week ? `/calendar?week=${week}` : "/calendar");
}

async function assertManual(supabase: UserClient, blockId: string) {
  const { data } = await supabase.from("busy_blocks").select("source").eq("id", blockId).maybeSingle();
  if (!data) throw new Error("Commitment not found");
  if (data.source !== "manual") {
    throw new Error("This block comes from Google Calendar. Edit it there and it will re-sync.");
  }
}

/**
 * A busy block's form fields as the instants the column stores.
 *
 * The form collects a date and two times in local wall-clock terms, which is
 * how people describe a shift; `zonedToUtc` is the only place that becomes an
 * instant, so the app's zone is applied exactly once.
 */
function readBusyBlock(formData: FormData) {
  const title = requiredString(formData, "title");
  const date = requiredString(formData, "date");
  const start = requiredString(formData, "startTime");
  const end = requiredString(formData, "endTime");

  // An end at or before the start means the block runs past midnight — a
  // closing shift, not a mistake. Rolling the *date* forward rather than
  // adding 24 hours keeps the end at the wall-clock time typed, even across a
  // daylight-saving change.
  const endDate = end <= start ? addDays(date, 1) : date;

  return {
    title,
    date,
    startTime: zonedToUtc(date, start).toISOString(),
    endTime: zonedToUtc(endDate, end).toISOString(),
  };
}
