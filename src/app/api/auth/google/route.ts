import { NextResponse, type NextRequest } from "next/server";
import { CALLBACK_PATH, GOOGLE_SCOPES, STATE_COOKIE, googleConfig } from "@/lib/google";

// Starts the Google OAuth flow. A random state is kept in an httpOnly cookie
// and checked by the callback to block CSRF.
export async function GET(request: NextRequest) {
  const { origin } = request.nextUrl;
  const config = googleConfig();
  if (!config) {
    return NextResponse.redirect(`${origin}/settings?google=not_configured`);
  }

  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return response;
}
