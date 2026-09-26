import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, mondayOf, todayIn, zonedToUtc } from "@/lib/dates";
import { freshAccessToken, getConnection, postForm } from "./oauth";

// Google Calendar sync (project-spec.md MVP #1): read-only import of timed,
// busy events from the user's selected calendars into busy_blocks, so the
// calendar and the busy-block conflict rule can schedule around them.

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    // Forces a refresh token even if the user granted access before.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string; id_token?: string };

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<TokenResponse> {
  return postForm(TOKEN_URL, {
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
}

async function refreshGoogle(refreshToken: string) {
  const t: TokenResponse = await postForm(TOKEN_URL, {
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: new Date(Date.now() + t.expires_in * 1000) };
}

export async function revokeGoogle(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(
    () => undefined,
  );
}

async function api<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`Google Calendar returned ${res.status}`);
  return res.json();
}

export type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  transparency?: "opaque" | "transparent";
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

// Timed events the user is actually busy for. All-day events (holidays,
// birthdays, "WFH") and events marked "free" or declined are skipped.
export function isBusy(e: GoogleEvent): boolean {
  if (e.status === "cancelled" || e.transparency === "transparent") return false;
  if (!e.start?.dateTime || !e.end?.dateTime) return false;
  const self = e.attendees?.find((a) => a.self);
  return self?.responseStatus !== "declined";
}

export async function syncGoogle(supabase: SupabaseClient, userId: string, timezone: string) {
  const conn = await getConnection(supabase, "google");
  if (!conn) throw new Error("Google Calendar isn't connected.");
  const token = await freshAccessToken(supabase, userId, conn, refreshGoogle);

  // Last week through five weeks out: enough for planning ahead, small
  // enough to stay well inside API quotas.
  const monday = mondayOf(todayIn(timezone));
  const timeMin = zonedToUtc(addDays(monday, -7), "00:00", timezone).toISOString();
  const timeMax = zonedToUtc(addDays(monday, 35), "00:00", timezone).toISOString();

  const { items: calendars = [] } = await api<{ items?: { id: string; selected?: boolean; primary?: boolean }[] }>(
    token,
    "/users/me/calendarList?minAccessRole=freeBusyReader",
  );
  const ids = calendars.filter((c) => c.selected || c.primary).map((c) => c.id);

  const blocks = new Map<string, { title: string; start_time: string; end_time: string }>();
  for (const calendarId of ids) {
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "2500",
        ...(pageToken ? { pageToken } : {}),
      });
      const page = await api<{ items?: GoogleEvent[]; nextPageToken?: string }>(
        token,
        `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      );
      for (const e of page.items ?? []) {
        if (!isBusy(e)) continue;
        // The same invite appears once per calendar it's on; keep one.
        blocks.set(e.id, {
          title: e.summary || "Busy",
          start_time: new Date(e.start!.dateTime!).toISOString(),
          end_time: new Date(e.end!.dateTime!).toISOString(),
        });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }

  const rows = [...blocks.entries()].map(([id, b]) => ({
    user_id: userId,
    google_event_id: id,
    source: "google_calendar" as const,
    ...b,
  }));
  if (rows.length) {
    const { error } = await supabase.from("busy_blocks").upsert(rows, { onConflict: "user_id,google_event_id" });
    if (error) throw new Error(`Could not save calendar events: ${error.message}`);
  }

  // Events deleted or moved out of the window on Google's side.
  const { data: stored } = await supabase
    .from("busy_blocks")
    .select("id, google_event_id")
    .eq("source", "google_calendar")
    .lt("start_time", timeMax)
    .gt("end_time", timeMin);
  const stale = (stored ?? []).filter((b) => !blocks.has(b.google_event_id)).map((b) => b.id);
  if (stale.length) await supabase.from("busy_blocks").delete().in("id", stale);

  await supabase
    .from("oauth_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("provider", "google");

  return { calendars: ids.length, events: rows.length, removed: stale.length };
}
