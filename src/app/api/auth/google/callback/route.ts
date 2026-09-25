import { NextResponse } from "next/server";
import { requireUser } from "@/lib/lift/queries";
import { getSettings } from "@/lib/settings";
import { checkState, redirectUri } from "@/lib/integrations/oauth";
import { exchangeGoogleCode, syncGoogle } from "@/lib/integrations/google";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (query: string) => NextResponse.redirect(new URL(`/settings?${query}#integrations`, url.origin));

  if (!(await checkState("google", url.searchParams.get("state")))) return back("error=oauth_state");
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.get("error")) return back("error=google_denied");

  const { supabase, user } = await requireUser();
  try {
    const t = await exchangeGoogleCode(code, redirectUri("google", url.origin));
    const { error } = await supabase.from("oauth_connections").upsert({
      user_id: user.id,
      provider: "google",
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? null,
      expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      scope: t.scope ?? null,
      last_synced_at: null,
    });
    if (error) throw new Error(error.message);
    const { timezone } = await getSettings();
    await syncGoogle(supabase, user.id, timezone);
  } catch (e) {
    return back(`error=google_failed&detail=${encodeURIComponent(e instanceof Error ? e.message : "unknown")}`);
  }
  return back("connected=google");
}
