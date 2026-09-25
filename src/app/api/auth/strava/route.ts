import { NextResponse } from "next/server";
import { issueState, redirectUri } from "@/lib/integrations/oauth";
import { stravaAuthorizeUrl, stravaConfigured } from "@/lib/integrations/strava";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  if (!stravaConfigured()) {
    return NextResponse.redirect(new URL("/settings?error=strava_not_configured", origin));
  }
  const state = await issueState("strava");
  return NextResponse.redirect(stravaAuthorizeUrl(redirectUri("strava", origin), state));
}
