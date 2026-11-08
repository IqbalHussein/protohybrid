import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/settings";
import {
  CALLBACK_PATH,
  STATE_COOKIE,
  emailFromIdToken,
  exchangeCode,
  expiresAtFrom,
  getConnection,
  hasCalendarScope,
  syncGoogleCalendar,
} from "@/lib/google";

// Google redirects here after consent. Validates state, stores tokens, runs
// a first sync, then returns to Settings with a status the page can show.
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const done = (status: string) => {
    const response = NextResponse.redirect(`${origin}/settings?google=${status}`);
    response.cookies.set(STATE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return response;
  };

  const expectedState = request.cookies.get(STATE_COOKIE)?.value;
  const state = searchParams.get("state");
  if (!expectedState || !state || state !== expectedState) return done("error");
  if (searchParams.get("error")) return done("denied");
  const code = searchParams.get("code");
  if (!code) return done("error");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  try {
    const tokens = await exchangeCode(code, `${origin}${CALLBACK_PATH}`);
    if (!hasCalendarScope(tokens.scope)) return done("missing_scope");

    // Google only returns a refresh token on some consents; keep the old one.
    const existing = await getConnection(supabase, user.id);
    const { error } = await supabase.from("oauth_connections").upsert(
      {
        user_id: user.id,
        provider: "google",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? existing?.refresh_token ?? null,
        expires_at: expiresAtFrom(tokens.expires_in),
        scope: tokens.scope ?? null,
        external_account_name: emailFromIdToken(tokens.id_token),
      },
      { onConflict: "user_id,provider" },
    );
    if (error) {
      console.error("Google connect: saving connection failed:", error.message);
      return done("error");
    }

    try {
      await syncGoogleCalendar(supabase, user.id, await getTimeZone());
    } catch (e) {
      // Connected, but the first sync failed; the user can retry from Settings.
      console.error("Google connect: initial sync failed:", e instanceof Error ? e.message : "unknown error");
      return done("sync_failed");
    }
    return done("connected");
  } catch (e) {
    console.error("Google connect failed:", e instanceof Error ? e.message : "unknown error");
    return done("error");
  }
}
