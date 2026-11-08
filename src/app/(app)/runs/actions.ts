"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { RUN_TYPES, parseDuration, type RunType } from "@/lib/runs";
import { isValidDate } from "@/lib/time";
import type { ActionState } from "@/components/ui/form-message";

function optionalNumber(value: FormDataEntryValue | null): number | null {
  const s = String(value ?? "").trim();
  return s === "" ? null : Number(s);
}

export async function logRun(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const date = String(formData.get("date") ?? "");
  const runType = String(formData.get("run_type") ?? "") as RunType;
  const distanceKm = Number(formData.get("distance_km"));
  const durationSec = parseDuration(String(formData.get("duration") ?? ""));
  const avgHr = optionalNumber(formData.get("avg_hr"));
  const elevation = optionalNumber(formData.get("elevation_m"));
  const notes = String(formData.get("notes") ?? "");

  if (!isValidDate(date)) return { error: "Pick a date." };
  if (!RUN_TYPES.includes(runType)) return { error: "Pick a run type." };
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return { error: "Distance must be greater than 0." };
  if (durationSec === null) return { error: "Enter duration as mm:ss or h:mm:ss." };
  if (avgHr !== null && (!Number.isInteger(avgHr) || avgHr < 20 || avgHr > 250))
    return { error: "Average HR must be a whole number from 20 to 250." };
  if (elevation !== null && (!Number.isFinite(elevation) || elevation < 0))
    return { error: "Elevation gain can't be negative." };

  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("log_run", {
    p_date: date,
    p_run_type: runType,
    p_distance_km: distanceKm,
    p_duration_sec: durationSec,
    p_avg_hr: avgHr,
    p_elevation_gain_m: elevation,
    p_notes: notes,
  });
  if (error) return { error: `Run not saved: ${error.message}` };

  revalidatePath("/runs");
  revalidatePath("/week");
  return { ok: true, message: "Run logged." };
}

// Records actuals on a planned (or already logged) run session.
export async function completeRun(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sessionId = String(formData.get("session_id") ?? "");
  const distanceKm = Number(formData.get("distance_km"));
  const durationSec = parseDuration(String(formData.get("duration") ?? ""));
  const avgHr = optionalNumber(formData.get("avg_hr"));
  const elevation = optionalNumber(formData.get("elevation_m"));
  const notes = String(formData.get("notes") ?? "");

  if (!sessionId) return { error: "Missing run." };
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return { error: "Distance must be greater than 0." };
  if (durationSec === null) return { error: "Enter duration as mm:ss or h:mm:ss." };
  if (avgHr !== null && (!Number.isInteger(avgHr) || avgHr < 20 || avgHr > 250))
    return { error: "Average HR must be a whole number from 20 to 250." };
  if (elevation !== null && (!Number.isFinite(elevation) || elevation < 0))
    return { error: "Elevation gain can't be negative." };

  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("complete_run", {
    p_session_id: sessionId,
    p_distance_km: distanceKm,
    p_duration_sec: durationSec,
    p_avg_hr: avgHr,
    p_elevation_m: elevation,
    p_notes: notes,
  });
  if (error) return { error: `Run not saved: ${error.message}` };

  revalidatePath("/runs");
  revalidatePath("/week");
  return { ok: true, message: "Run completed." };
}

export async function deleteRun(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  if (!sessionId) return;
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("delete_session", { p_session_id: sessionId });
  if (error) throw new Error(`Run not deleted: ${error.message}`);
  revalidatePath("/runs");
  revalidatePath("/week");
}

export async function skipRun(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  if (!sessionId) return;
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("set_session_status", { p_session_id: sessionId, p_status: "skipped" });
  if (error) throw new Error(`Run not skipped: ${error.message}`);
  revalidatePath("/runs");
  revalidatePath("/week");
}
