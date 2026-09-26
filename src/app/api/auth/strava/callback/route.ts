import { NextResponse } from "next/server";
import { requireUser } from "@/lib/lift/queries";
import { checkState } from "@/lib/integrations/oauth";
import { exchangeStravaCode, syncStrava } from "@/lib/integrations/strava";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (query: string) => NextResponse.redirect(new URL(`/settings?${query}#integrations`, url.origin));

  if (!(await checkState("strava", url.searchParams.get("state")))) return back("error=oauth_state");
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.get("error")) return back("error=strava_denied");
  // Without activity:read_all, private runs are invisible and sync looks broken.
  if (!(url.searchParams.get("scope") ?? "").includes("activity:read")) return back("error=strava_scope");

  const { supabase, user } = await requireUser();
  try {
    const t = await exchangeStravaCode(code);
    const { error } = await supabase.from("oauth_connections").upsert({
      user_id: user.id,
      provider: "strava",
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: new Date(t.expires_at * 1000).toISOString(),
      scope: url.searchParams.get("scope"),
      external_account_id: t.athlete ? String(t.athlete.id) : null,
      external_account_name: t.athlete ? [t.athlete.firstname, t.athlete.lastname].filter(Boolean).join(" ") : null,
      last_synced_at: null,
    });
    if (error) throw new Error(error.message);
    await syncStrava(supabase, user.id);
  } catch (e) {
    return back(`error=strava_failed&detail=${encodeURIComponent(e instanceof Error ? e.message : "unknown")}`);
  }
  return back("connected=strava");
}
