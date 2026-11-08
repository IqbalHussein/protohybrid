"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { parseDuration } from "@/lib/runs";
import { isValidDate, parseTime } from "@/lib/time";
import { RUN_TYPES, type RunType, type SessionStatus } from "@/lib/types";
import type { ActionState } from "@/components/ui/form-message";
import { isUuid } from "@/lib/lifts";


function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function revalidate() {
  revalidatePath("/week");
  revalidatePath("/runs");
  revalidatePath("/lifts");
}

// "" -> null; "HH:MM" -> "HH:MM"; anything else -> undefined (invalid).
function optionalTime(value: string): string | null | undefined {
  if (value === "") return null;
  return parseTime(value) === null ? undefined : value.slice(0, 5);
}

export async function planSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const kind = text(formData, "kind");
  const date = text(formData, "date");
  const startTime = optionalTime(text(formData, "start_time"));
  const durationRaw = text(formData, "duration_min");
  const durationMin = durationRaw === "" ? null : Number(durationRaw);

  if (!isValidDate(date)) return { error: "Pick a date." };
  if (startTime === undefined) return { error: "Start time must be HH:MM." };
  if (durationMin !== null && (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > 1440))
    return { error: "Duration must be a whole number of minutes from 1 to 1440." };

  const { supabase } = await requireUser();

  if (kind === "run") {
    const runType = text(formData, "run_type") as RunType;
    if (!RUN_TYPES.includes(runType)) return { error: "Pick a run type." };
    const distanceRaw = text(formData, "target_distance_km");
    const distance = distanceRaw === "" ? null : Number(distanceRaw);
    if (distance !== null && (!Number.isFinite(distance) || distance <= 0 || distance > 1000))
      return { error: "Target distance must be between 0 and 1000 km." };
    const targetDurationRaw = text(formData, "target_duration");
    const targetDuration = targetDurationRaw === "" ? null : parseDuration(targetDurationRaw);
    if (targetDurationRaw !== "" && targetDuration === null) return { error: "Target time must be mm:ss or h:mm:ss." };
    const paceRaw = text(formData, "target_pace");
    const pace = paceRaw === "" ? null : parseDuration(paceRaw);
    if (paceRaw !== "" && pace === null) return { error: "Target pace must be mm:ss per km." };

    const { error } = await supabase.rpc("plan_run", {
      p_date: date,
      p_run_type: runType,
      p_start_time: startTime,
      p_duration_min: durationMin,
      p_target_distance_km: distance,
      p_target_duration_sec: targetDuration,
      p_target_pace_sec_per_km: pace,
    });
    if (error) return { error: `Run not planned: ${error.message}` };
    revalidate();
    return { ok: true, message: "Run planned." };
  }

  if (kind === "lift") {
    const focus = text(formData, "focus");
    if (!focus || focus.length > 50) return { error: "Pick a focus." };
    const routineId = text(formData, "routine_id");
    if (routineId !== "" && !isUuid(routineId)) return { error: "Pick a routine from the list." };
    const notes = text(formData, "notes");
    if (notes.length > 2000) return { error: "Notes are too long." };

    const { error } = await supabase.rpc("plan_lift", {
      p_date: date,
      p_focus: focus,
      p_start_time: startTime,
      p_duration_min: durationMin,
      p_routine_id: routineId || null,
      p_notes: notes || null,
    });
    if (error) return { error: `Lift not planned: ${error.message}` };
    revalidate();
    return { ok: true, message: "Lift planned." };
  }

  return { error: "Choose run or lift." };
}

// Used by drag and drop (keeps the time) and by the Move dialog.
export async function moveSession(sessionId: string, date: string, startTime: string | null): Promise<ActionState> {
  if (!isUuid(sessionId)) return { error: "Unknown session." };
  if (!isValidDate(date)) return { error: "Pick a date." };
  const time = optionalTime(startTime ?? "");
  if (time === undefined) return { error: "Start time must be HH:MM." };

  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("reschedule_session", {
    p_session_id: sessionId,
    p_date: date,
    p_start_time: time,
  });
  if (error) return { error: `Session not moved: ${error.message}` };
  revalidate();
  return { ok: true, message: "Session moved." };
}

export async function moveSessionForm(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return moveSession(text(formData, "session_id"), text(formData, "date"), text(formData, "start_time") || null);
}

export async function setStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sessionId = text(formData, "session_id");
  const status = text(formData, "status") as SessionStatus;
  if (!isUuid(sessionId)) return { error: "Unknown session." };
  if (status !== "planned" && status !== "skipped") return { error: "Unknown status." };

  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("set_session_status", { p_session_id: sessionId, p_status: status });
  if (error) return { error: `Status not changed: ${error.message}` };
  revalidate();
  return { ok: true, message: status === "skipped" ? "Session skipped." : "Session restored." };
}

export async function deleteSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sessionId = text(formData, "session_id");
  if (!isUuid(sessionId)) return { error: "Unknown session." };

  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("delete_session", { p_session_id: sessionId });
  if (error) return { error: `Session not deleted: ${error.message}` };
  revalidate();
  return { ok: true, message: "Session deleted." };
}
