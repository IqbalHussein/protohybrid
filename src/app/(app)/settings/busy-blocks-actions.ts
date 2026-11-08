"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getTimeZone } from "@/lib/settings";
import { addDays, isValidDate, parseTime, zonedToUtc } from "@/lib/time";
import type { ActionState } from "@/components/ui/form-message";

export async function addBusyBlock(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const title = String(formData.get("title") ?? "").trim();
  const date = String(formData.get("date") ?? "");
  const start = String(formData.get("start") ?? "");
  const end = String(formData.get("end") ?? "");

  if (!title) return { error: "Give the busy time a name." };
  if (title.length > 200) return { error: "Keep the name under 200 characters." };
  if (!isValidDate(date)) return { error: "Pick a date." };
  const startMin = parseTime(start);
  const endMin = parseTime(end);
  if (startMin === null || endMin === null) return { error: "Enter a start and end time." };
  if (startMin === endMin) return { error: "End time must be different from start time." };

  const tz = await getTimeZone();
  // An end time at or before the start means the block ends the next day.
  const endDate = endMin < startMin ? addDays(date, 1) : date;
  const startUtc = zonedToUtc(date, start, tz);
  const endUtc = zonedToUtc(endDate, end, tz);
  if (endUtc <= startUtc) return { error: "End must be after start." };

  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("busy_blocks").insert({
    user_id: user.id,
    title,
    start_time: startUtc.toISOString(),
    end_time: endUtc.toISOString(),
    source: "manual",
  });
  if (error) return { error: `Busy time not saved: ${error.message}` };

  revalidatePath("/settings");
  revalidatePath("/week");
  return { ok: true, message: "Busy time added." };
}

export async function deleteBusyBlock(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { supabase } = await requireUser();
  // Synced blocks are owned by Google sync; only manual ones can be deleted here.
  const { error } = await supabase.from("busy_blocks").delete().eq("id", id).eq("source", "manual");
  if (error) throw new Error(`Busy time not deleted: ${error.message}`);
  revalidatePath("/settings");
  revalidatePath("/week");
}
