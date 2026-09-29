import { after } from "next/server";
import { createAdminClient, adminConfigured } from "@/lib/supabase/admin";
import { secretMatches, stravaEventAction, type StravaEventAction } from "@/lib/integrations/background";
import { stravaStillAuthorized, syncStrava } from "@/lib/integrations/strava";

/**
 * Strava's push subscription: a run shows up on the calendar minutes after
 * it's uploaded instead of waiting for "Sync now".
 *
 * GET is Strava confirming the subscription when it's created (see README).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (
    params.get("hub.mode") === "subscribe" &&
    secretMatches(params.get("hub.verify_token"), process.env.STRAVA_WEBHOOK_VERIFY_TOKEN)
  ) {
    return Response.json({ "hub.challenge": params.get("hub.challenge") });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * An event. Strava wants a 200 within two seconds and a sync takes longer, so
 * the work runs after the response. Events aren't signed; the worst a forged
 * one can do is make the app sync a real user's own Strava data, and a forged
 * "deauthorized" is checked with Strava before anything is deleted.
 */
export async function POST(request: Request) {
  const event = await request.json().catch(() => ({}));
  const action = stravaEventAction(event);

  if (action.kind !== "ignore" && adminConfigured()) {
    after(async () => {
      try {
        await handle(action);
      } catch (e) {
        console.error("Strava webhook failed:", e instanceof Error ? e.message : e);
      }
    });
  }
  return new Response(null, { status: 200 });
}

async function handle(action: Exclude<StravaEventAction, { kind: "ignore" }>) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("oauth_connections")
    .select("user_id")
    .eq("provider", "strava")
    .eq("external_account_id", action.athleteId)
    .maybeSingle();
  if (!data) return;
  const userId = data.user_id as string;

  if (action.kind === "sync") {
    await syncStrava(admin, userId);
    return;
  }

  // Revoked on Strava's side: drop the dead tokens. Imported runs stay, the
  // same as disconnecting from Settings.
  if (!(await stravaStillAuthorized(admin, userId))) {
    await admin.from("oauth_connections").delete().eq("user_id", userId).eq("provider", "strava");
  }
}
