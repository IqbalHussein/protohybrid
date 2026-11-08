import type { SupabaseClient } from "@supabase/supabase-js";
import type { OAuthConnection } from "./types";
import { addDays, todayIn, zonedToUtc } from "./time";

// Google Calendar integration over plain fetch. Tokens live in
// oauth_connections (provider 'google') under RLS; they are never logged.

export const GOOGLE_SCOPES = "openid email https://www.googleapis.com/auth/calendar.readonly";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const STATE_COOKIE = "google_oauth_state";
export const CALLBACK_PATH = "/api/auth/google/callback";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

// Sync window relative to the user's local today.
export const SYNC_DAYS_BACK = 14;
export const SYNC_DAYS_AHEAD = 56;

export function googleConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

// Thrown when the stored grant no longer works and the user must reconnect.
export class GoogleReconnectError extends Error {
  constructor() {
    super("Google Calendar access was revoked or expired. Reconnect to keep syncing.");
    this.name = "GoogleReconnectError";
  }
}

// ---- Pure helpers (unit tested) ------------------------------------------

export type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

export type GoogleBusyBlock = {
  google_event_id: string;
  title: string;
  start_time: string;
  end_time: string;
};

// Keeps events that actually make the user busy: timed (not all-day), not
// cancelled, not marked "free", not declined, and with end after start.
export function eventsToBusyBlocks(events: GoogleEvent[]): GoogleBusyBlock[] {
  const blocks: GoogleBusyBlock[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (!e.id || seen.has(e.id)) continue;
    if (e.status === "cancelled") continue;
    if (e.transparency === "transparent") continue;
    if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;
    const start = e.start?.dateTime;
    const end = e.end?.dateTime;
    if (!start || !end) continue;
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    seen.add(e.id);
    blocks.push({
      google_event_id: e.id,
      title: e.summary?.trim() || "Busy",
      start_time: new Date(startMs).toISOString(),
      end_time: new Date(endMs).toISOString(),
    });
  }
  return blocks;
}

// True when the access token is missing an expiry or expires within skewMs.
export function needsRefresh(expiresAt: string | null, now: Date = new Date(), skewMs = 60_000): boolean {
  if (!expiresAt) return true;
  const ms = Date.parse(expiresAt);
  return !Number.isFinite(ms) || ms - now.getTime() <= skewMs;
}

export function expiresAtFrom(expiresInSec: number | undefined, now: Date = new Date()): string | null {
  if (!expiresInSec || !Number.isFinite(expiresInSec)) return null;
  return new Date(now.getTime() + expiresInSec * 1000).toISOString();
}

// Reads the email claim from an id_token for display only. The token came
// straight from Google's token endpoint over TLS, so it isn't verified here;
// never use this value for authorization.
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

export function hasCalendarScope(scope: string | null | undefined): boolean {
  return (scope ?? "").split(/\s+/).includes(CALENDAR_SCOPE);
}

// UTC instants bounding the sync window in the user's timezone.
export function syncWindow(tz: string, now: Date = new Date()): { timeMin: Date; timeMax: Date } {
  const today = todayIn(tz, now);
  return {
    timeMin: zonedToUtc(addDays(today, -SYNC_DAYS_BACK), "00:00", tz),
    timeMax: zonedToUtc(addDays(today, SYNC_DAYS_AHEAD), "00:00", tz),
  };
}

// ---- Network + database --------------------------------------------------

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
};

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const config = googleConfig();
  if (!config) throw new Error("Google Calendar isn't configured");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !body.access_token) {
    throw new Error(`Google token exchange failed (${res.status}${body.error ? `: ${body.error}` : ""})`);
  }
  return body;
}

export async function getConnection(supabase: SupabaseClient, userId: string): Promise<OAuthConnection | null> {
  const { data, error } = await supabase
    .from("oauth_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle<OAuthConnection>();
  if (error) throw new Error(`Couldn't load Google connection: ${error.message}`);
  return data;
}

async function removeConnection(supabase: SupabaseClient, userId: string) {
  const { error } = await supabase.from("oauth_connections").delete().eq("user_id", userId).eq("provider", "google");
  if (error) throw new Error(`Couldn't remove the Google connection: ${error.message}`);
}

// Returns a usable access token, refreshing it when it is about to expire.
export async function getValidAccessToken(supabase: SupabaseClient, userId: string): Promise<string> {
  const conn = await getConnection(supabase, userId);
  if (!conn) throw new GoogleReconnectError();
  if (!needsRefresh(conn.expires_at)) return conn.access_token;

  const config = googleConfig();
  if (!config) throw new Error("Google Calendar isn't configured");
  if (!conn.refresh_token) {
    await removeConnection(supabase, userId);
    throw new GoogleReconnectError();
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !body.access_token) {
    if (body.error === "invalid_grant") {
      await removeConnection(supabase, userId);
      throw new GoogleReconnectError();
    }
    throw new Error(`Google token refresh failed (${res.status}${body.error ? `: ${body.error}` : ""})`);
  }

  const { error } = await supabase
    .from("oauth_connections")
    .update({
      access_token: body.access_token,
      expires_at: expiresAtFrom(body.expires_in),
      ...(body.refresh_token ? { refresh_token: body.refresh_token } : {}),
      ...(body.scope ? { scope: body.scope } : {}),
    })
    .eq("user_id", userId)
    .eq("provider", "google");
  if (error) throw new Error(`Couldn't save refreshed Google token: ${error.message}`);
  return body.access_token;
}

export async function listEvents(accessToken: string, timeMin: Date, timeMax: Date): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  // Hard stop so a misbehaving API can't loop forever (40 x 250 events).
  for (let page = 0; page < 40; page++) {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${EVENTS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (res.status === 401) throw new GoogleReconnectError();
    if (!res.ok) throw new Error(`Google Calendar request failed (${res.status})`);
    const body = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
    events.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
    if (!pageToken) return events;
  }
  // Returning a partial list would make the sync prune real events as stale.
  throw new Error("Your calendar has too many events in the sync window to sync. Nothing was changed.");
}

export type SyncResult = { upserted: number; removed: number };

// Mirrors the primary calendar's busy events in the sync window into
// busy_blocks (source google_calendar), removing ones that no longer exist.
export async function syncGoogleCalendar(supabase: SupabaseClient, userId: string, tz: string): Promise<SyncResult> {
  const accessToken = await getValidAccessToken(supabase, userId);
  const { timeMin, timeMax } = syncWindow(tz);
  const blocks = eventsToBusyBlocks(await listEvents(accessToken, timeMin, timeMax));

  for (let i = 0; i < blocks.length; i += 200) {
    const chunk = blocks.slice(i, i + 200).map((b) => ({ ...b, user_id: userId, source: "google_calendar" as const }));
    const { error } = await supabase.from("busy_blocks").upsert(chunk, { onConflict: "user_id,google_event_id" });
    if (error) throw new Error(`Couldn't save calendar events: ${error.message}`);
  }

  const { data: existing, error: listError } = await supabase
    .from("busy_blocks")
    .select("id, google_event_id")
    .eq("user_id", userId)
    .eq("source", "google_calendar")
    .gte("start_time", timeMin.toISOString())
    .lt("start_time", timeMax.toISOString());
  if (listError) throw new Error(`Couldn't read calendar events: ${listError.message}`);

  const keep = new Set(blocks.map((b) => b.google_event_id));
  const stale = (existing ?? []).filter((b) => !b.google_event_id || !keep.has(b.google_event_id)).map((b) => b.id);
  for (let i = 0; i < stale.length; i += 100) {
    const { error } = await supabase.from("busy_blocks").delete().in("id", stale.slice(i, i + 100));
    if (error) throw new Error(`Couldn't remove old calendar events: ${error.message}`);
  }

  await supabase
    .from("oauth_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("provider", "google");

  return { upserted: blocks.length, removed: stale.length };
}

// Revokes the grant at Google (best effort) and removes local data.
export async function disconnectGoogle(supabase: SupabaseClient, userId: string): Promise<void> {
  const conn = await getConnection(supabase, userId);
  const token = conn?.refresh_token ?? conn?.access_token;
  if (token) {
    try {
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        cache: "no-store",
      });
    } catch {
      // Revocation is best effort; local removal below still disconnects.
    }
  }
  // Remove synced blocks first: once the connection is gone they could no
  // longer be cleared from the UI.
  const { error } = await supabase.from("busy_blocks").delete().eq("user_id", userId).eq("source", "google_calendar");
  if (error) throw new Error(`Couldn't remove synced events: ${error.message}`);
  await removeConnection(supabase, userId);
}
