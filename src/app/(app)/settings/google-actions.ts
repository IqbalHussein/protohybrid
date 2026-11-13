"use server";

// Server actions follow one pattern: validate the form here (so users get
// specific messages), call a database function or RLS-guarded table, then
// revalidate the pages that show the data. Ownership is enforced by RLS and
// the database functions, not here.

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getTimeZone } from "@/lib/settings";
import { GoogleReconnectError, disconnectGoogle, syncGoogleCalendar } from "@/lib/google";
import type { ActionState } from "@/components/ui/form-message";

export async function syncGoogleNow(): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  try {
    const { upserted, removed } = await syncGoogleCalendar(supabase, user.id, await getTimeZone());
    revalidatePath("/settings");
    revalidatePath("/week");
    const parts = [`${upserted} ${upserted === 1 ? "event" : "events"} synced`];
    if (removed) parts.push(`${removed} removed`);
    return { ok: true, message: `${parts.join(", ")}.` };
  } catch (e) {
    revalidatePath("/settings");
    if (e instanceof GoogleReconnectError) return { error: e.message };
    return { error: `Sync failed: ${e instanceof Error ? e.message : "unknown error"}` };
  }
}

export async function disconnectGoogleAction(): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  try {
    await disconnectGoogle(supabase, user.id);
  } catch (e) {
    return { error: `Disconnect failed: ${e instanceof Error ? e.message : "unknown error"}` };
  }
  revalidatePath("/settings");
  revalidatePath("/week");
  return { ok: true, message: "Google Calendar disconnected." };
}
