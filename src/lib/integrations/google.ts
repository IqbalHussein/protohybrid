import type { UserClient } from "@/lib/auth";
import { zonedToUtc } from "@/lib/time";
import { addDays, currentWeekStart } from "@/lib/week";
import { freshAccessToken, getConnection, markSynced, postForm, type RefreshedToken } from "./oauth";

/**
 * Google Calendar sync (project-spec.md MVP #1). A read-only import of the
 * events the user is actually busy for, written to `busy_blocks` as the second
 * writer the weekly-calendar spec planned for: the grid draws them exactly as
 * it draws manual ones, and the overlap rule checks against both.
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

/** Last week through five weeks out: enough to plan ahead, well inside Google's quotas. */
const WEEKS_BACK = 1;
const WEEKS_AHEAD = 5;

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
    // Google only issues a refresh token on first consent; forcing the prompt
    // means reconnecting after a disconnect gets one too.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<TokenResponse> {
  return postForm<TokenResponse>(TOKEN_URL, {
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
}

async function refreshGoogle(refreshToken: string): Promise<RefreshedToken> {
  const token = await postForm<TokenResponse>(TOKEN_URL, {
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: new Date(Date.now() + token.expires_in * 1000),
  };
}

/** Best effort: a failed revoke must not stop the user disconnecting. */
export async function revokeGoogle(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
  }).catch(() => undefined);
}

async function api<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google Calendar returned ${res.status}`);
  return (await res.json()) as T;
}

export type GoogleCalendar = {
  id: string;
  summary?: string;
  primary?: boolean;
  /** "owner" | "writer" | "reader" | "freeBusyReader" */
  accessRole?: string;
};

async function fetchCalendars(token: string): Promise<GoogleCalendar[]> {
  const { items = [] } = await api<{ items?: GoogleCalendar[] }>(
    token,
    "/users/me/calendarList?minAccessRole=freeBusyReader",
  );
  return items;
}

/** The user's calendars, for the picker in Settings. */
export async function listGoogleCalendars(supabase: UserClient, userId: string): Promise<GoogleCalendar[]> {
  const connection = await getConnection(supabase, "google");
  if (!connection) return [];
  const token = await freshAccessToken(supabase, userId, connection, refreshGoogle);
  return fetchCalendars(token);
}

/**
 * Which calendars to import. Until the user chooses, only the primary
 * calendar — the one that is certainly their own; ticking a calendar in
 * Google's sidebar only means they like to see it, and it may well be
 * someone else's. After a choice, exactly the chosen calendars that still
 * exist, which may be none.
 */
export function calendarsToSync(calendars: GoogleCalendar[], chosen: string[] | null): string[] {
  if (chosen == null) return calendars.filter((c) => c.primary).map((c) => c.id);
  const available = new Set(calendars.map((c) => c.id));
  return chosen.filter((id) => available.has(id));
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

/**
 * Whether an event should block training. All-day events (holidays,
 * birthdays, "WFH") would black out whole days, and events marked "free" or
 * declined aren't commitments at all.
 */
export function isBusy(event: GoogleEvent): boolean {
  if (event.status === "cancelled" || event.transparency === "transparent") return false;
  if (!event.start?.dateTime || !event.end?.dateTime) return false;
  if (new Date(event.end.dateTime) <= new Date(event.start.dateTime)) return false; // busy_blocks_time_order
  const self = event.attendees?.find((a) => a.self);
  return self?.responseStatus !== "declined";
}

export function toBusyBlock(event: GoogleEvent) {
  return {
    title: event.summary?.trim() || "Busy",
    start_time: new Date(event.start!.dateTime!).toISOString(),
    end_time: new Date(event.end!.dateTime!).toISOString(),
  };
}

export type GoogleSyncResult = { calendars: number; events: number; removed: number };

export async function syncGoogle(supabase: UserClient, userId: string): Promise<GoogleSyncResult> {
  const connection = await getConnection(supabase, "google");
  if (!connection) throw new Error("Google Calendar isn't connected.");
  const token = await freshAccessToken(supabase, userId, connection, refreshGoogle);

  const monday = currentWeekStart();
  const timeMin = zonedToUtc(addDays(monday, -7 * WEEKS_BACK)).toISOString();
  const timeMax = zonedToUtc(addDays(monday, 7 * (WEEKS_AHEAD + 1))).toISOString();

  const calendarIds = calendarsToSync(await fetchCalendars(token), connection.calendar_ids);

  // Keyed by event id: an invite on two calendars is one commitment.
  const events = new Map<string, ReturnType<typeof toBusyBlock>>();
  for (const calendarId of calendarIds) {
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
      for (const event of page.items ?? []) {
        if (isBusy(event)) events.set(event.id, toBusyBlock(event));
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }

  const rows = [...events].map(([id, block]) => ({
    user_id: userId,
    google_event_id: id,
    source: "google_calendar" as const,
    ...block,
  }));
  if (rows.length) {
    const { error } = await supabase.from("busy_blocks").upsert(rows, { onConflict: "user_id,google_event_id" });
    if (error) throw new Error(`Could not save calendar events: ${error.message}`);
  }

  // Events deleted, declined or moved out of the window on Google's side.
  const { data: stored } = await supabase
    .from("busy_blocks")
    .select("id, google_event_id")
    .eq("user_id", userId)
    .eq("source", "google_calendar")
    .lt("start_time", timeMax)
    .gt("end_time", timeMin);
  const stale = (stored ?? []).filter((b) => !events.has(b.google_event_id as string)).map((b) => b.id as string);
  if (stale.length) {
    const { error } = await supabase.from("busy_blocks").delete().in("id", stale);
    if (error) throw new Error(`Could not remove deleted events: ${error.message}`);
  }

  await markSynced(supabase, userId, "google");
  return { calendars: calendarIds.length, events: rows.length, removed: stale.length };
}
