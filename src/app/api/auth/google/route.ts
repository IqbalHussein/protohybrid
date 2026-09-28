import { NextResponse } from "next/server";
import { issueState, redirectUri } from "@/lib/integrations/oauth";
import { googleAuthorizeUrl, googleConfigured } from "@/lib/integrations/google";

/** Starts the Google OAuth round trip from Settings' "Connect" link. */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/settings?error=google_not_configured#integrations", origin));
  }
  const state = await issueState("google");
  return NextResponse.redirect(googleAuthorizeUrl(redirectUri("google", origin), state));
}
