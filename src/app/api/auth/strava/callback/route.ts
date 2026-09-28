import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { checkState } from "@/lib/integrations/oauth";
import { exchangeStravaCode, syncStrava } from "@/lib/integrations/strava";

/** Where Strava sends the user back: store the tokens, then run a first sync. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (query: string) => NextResponse.redirect(new URL(`/settings?${query}#integrations`, url.origin));

  if (!(await checkState("strava", url.searchParams.get("state")))) return back("error=oauth_state");
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.get("error")) return back("error=strava_denied");
  // Strava lets the user untick scopes on its consent screen.
  if (!(url.searchParams.get("scope") ?? "").includes("activity:read")) return back("error=strava_scope");

  const { supabase, user } = await requireUser();
  try {
    const token = await exchangeStravaCode(code);
    const { error } = await supabase.from("oauth_connections").upsert({
      user_id: user.id,
      provider: "strava",
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: new Date(token.expires_at * 1000).toISOString(),
      scope: url.searchParams.get("scope"),
      external_account_id: token.athlete ? String(token.athlete.id) : null,
      external_account_name: token.athlete
        ? [token.athlete.firstname, token.athlete.lastname].filter(Boolean).join(" ") || null
        : null,
      last_synced_at: null,
    });
    if (error) throw new Error(error.message);
    await syncStrava(supabase, user.id);
  } catch (e) {
    return back(`error=strava_failed&detail=${encodeURIComponent(e instanceof Error ? e.message : "unknown")}`);
  }
  return back("connected=strava");
}
