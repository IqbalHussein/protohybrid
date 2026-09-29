import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/integrations/background";
import { syncGoogle } from "@/lib/integrations/google";
import { syncStrava } from "@/lib/integrations/strava";

// A sync is a few provider round trips per user; give it room.
export const maxDuration = 60;

/**
 * Scheduled sync for every connection (vercel.json). Google has no push that
 * suits a personal app, so this is how busy blocks stay current; for Strava it
 * catches anything a webhook missed.
 *
 * One user's failure (a revoked grant, a rate limit) is recorded and the rest
 * carry on. Only counts leave this function — no ids or event details in logs.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = createAdminClient();
  const { data: connections, error } = await admin.from("oauth_connections").select("user_id, provider");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const summary = { synced: 0, failed: 0 };
  for (const c of connections ?? []) {
    try {
      if (c.provider === "strava") await syncStrava(admin, c.user_id as string);
      else await syncGoogle(admin, c.user_id as string);
      summary.synced++;
    } catch (e) {
      summary.failed++;
      console.error(`Scheduled ${c.provider} sync failed:`, e instanceof Error ? e.message : e);
    }
  }
  return Response.json(summary);
}
