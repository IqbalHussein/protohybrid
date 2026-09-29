import type { UserClient } from "@/lib/auth";
import { paceFrom } from "@/lib/calendar/runs";
import type { RunType } from "@/lib/calendar/types";
import { findOrCreatePlanForDate } from "@/lib/plans";
import { minutesIntoDay, minutesToTimeString, zonedDateString } from "@/lib/time";
import { freshAccessToken, getConnection, markSynced, postForm, type RefreshedToken } from "./oauth";

/**
 * Strava sync (project-spec.md MVP #3). Pulls completed runs and either fills
 * in the actuals of the run planned for that day or files the run as an
 * ad-hoc session, so the calendar shows everything that actually happened.
 */

const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const API = "https://www.strava.com/api/v3";
const RUN_SPORTS = new Set(["Run", "TrailRun", "VirtualRun"]);

/** How far back a first sync reaches. */
const FIRST_SYNC_DAYS = 30;
/**
 * How far before the last sync later syncs reach back. Strava's `after`
 * filters on when an activity started, not when it was uploaded, so a watch
 * synced to Strava days after the run needs this margin to be picked up; it
 * also lets edits made on Strava (title, workout type) come through.
 */
const RESYNC_OVERLAP_DAYS = 14;

export function stravaConfigured(): boolean {
  return Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
}

export function stravaAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    // Without activity:read_all, runs marked private are invisible and sync
    // looks broken.
    scope: "read,activity:read_all",
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
  athlete?: { id: number; firstname?: string; lastname?: string };
};

export async function exchangeStravaCode(code: string): Promise<TokenResponse> {
  return postForm<TokenResponse>(TOKEN_URL, {
    client_id: process.env.STRAVA_CLIENT_ID!,
    client_secret: process.env.STRAVA_CLIENT_SECRET!,
    code,
    grant_type: "authorization_code",
  });
}

async function refreshStrava(refreshToken: string): Promise<RefreshedToken> {
  const token = await postForm<TokenResponse>(TOKEN_URL, {
    client_id: process.env.STRAVA_CLIENT_ID!,
    client_secret: process.env.STRAVA_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: new Date(token.expires_at * 1000),
  };
}

/** Best effort: a failed revoke must not stop the user disconnecting. */
export async function revokeStrava(accessToken: string) {
  await fetch("https://www.strava.com/oauth/deauthorize", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => undefined);
}

/**
 * Whether the user's Strava grant still works. Strava's webhook events aren't
 * signed, so a "deauthorized" event is only believed once Strava itself
 * refuses the token; a network failure is not a refusal and throws instead.
 */
export async function stravaStillAuthorized(supabase: UserClient, userId: string): Promise<boolean> {
  const connection = await getConnection(supabase, userId, "strava");
  if (!connection) return false;

  let token: string;
  try {
    token = await freshAccessToken(supabase, userId, connection, refreshStrava);
  } catch (e) {
    // postForm reports the status; a refused refresh token is a revoked grant.
    if (e instanceof Error && /returned (400|401)\b/.test(e.message)) return false;
    throw e;
  }

  const res = await fetch(`${API}/athlete`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (res.status === 401) return false;
  if (!res.ok) throw new Error(`Strava returned ${res.status}`);
  return true;
}

export type StravaActivity = {
  id: number;
  name: string;
  sport_type?: string;
  type: string;
  workout_type?: number | null;
  start_date: string; // ISO instant, UTC
  distance: number; // metres
  moving_time: number; // seconds
  average_heartrate?: number;
  total_elevation_gain?: number; // metres
};

export function isRun(activity: StravaActivity): boolean {
  return RUN_SPORTS.has(activity.sport_type ?? activity.type);
}

/** Strava's run workout_type: 1 race, 2 long run, 3 workout; anything else is a default run. */
export function classifyRun(activity: StravaActivity): RunType {
  if (activity.workout_type === 1) return "race";
  if (activity.workout_type === 2) return "long";
  if (activity.workout_type === 3) return "interval";
  return "easy";
}

/** The run_details columns an activity fills. The same pace rule as a manually logged run. */
export function activityActuals(activity: StravaActivity) {
  const km = Math.round(activity.distance / 10) / 100;
  return {
    actual_distance_km: km,
    actual_duration_sec: activity.moving_time,
    actual_pace_sec_per_km: paceFrom(km, activity.moving_time),
    actual_avg_hr: activity.average_heartrate ?? null,
    actual_elevation_m: activity.total_elevation_gain ?? null,
    actual_started_at: activity.start_date,
    strava_activity_id: String(activity.id),
    strava_name: activity.name,
  };
}

/**
 * Where an activity lands on the calendar, in the app's zone.
 *
 * Strava's `start_date_local` is the athlete's wall clock wherever they ran,
 * which on a trip is not the zone the calendar is drawn in. Converting the
 * real instant keeps an imported run next to the busy blocks it happened
 * between.
 */
export function activityPlacement(activity: StravaActivity) {
  const start = new Date(activity.start_date);
  return {
    date: zonedDateString(start),
    startTime: minutesToTimeString(minutesIntoDay(start)),
    durationMin: Math.max(1, Math.round(activity.moving_time / 60)),
  };
}

type Candidate = { id: string; status: string; run_type: RunType | null };

/**
 * Which planned run an activity completes, if any: one that isn't skipped
 * and hasn't got an activity yet. A still-planned run beats one already
 * marked done by hand, and a matching run type breaks the tie.
 */
export function pickPlannedRun(candidates: Candidate[], activity: StravaActivity): Candidate | null {
  const kind = classifyRun(activity);
  const score = (c: Candidate) => (c.status === "planned" ? 2 : 0) + (c.run_type === kind ? 1 : 0);
  return [...candidates].sort((a, b) => score(b) - score(a))[0] ?? null;
}

async function fetchRuns(token: string, afterEpoch: number): Promise<StravaActivity[]> {
  const out: StravaActivity[] = [];
  // 10 pages of 100 is far past any real backlog, and bounds a runaway loop.
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${API}/athlete/activities?after=${afterEpoch}&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 429) throw new Error("Strava's rate limit was reached. Try again in 15 minutes.");
    if (!res.ok) throw new Error(`Strava returned ${res.status}`);
    const batch = (await res.json()) as StravaActivity[];
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out.filter(isRun);
}

export type StravaSyncResult = { runs: number; matched: number; created: number; refreshed: number; since: string };

export async function syncStrava(supabase: UserClient, userId: string): Promise<StravaSyncResult> {
  const connection = await getConnection(supabase, userId, "strava");
  if (!connection) throw new Error("Strava isn't connected.");
  const token = await freshAccessToken(supabase, userId, connection, refreshStrava);

  const since = connection.last_synced_at
    ? new Date(new Date(connection.last_synced_at).getTime() - RESYNC_OVERLAP_DAYS * 86_400_000)
    : new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000);
  const runs = await fetchRuns(token, Math.floor(since.getTime() / 1000));

  const result: StravaSyncResult = { runs: runs.length, matched: 0, created: 0, refreshed: 0, since: zonedDateString(since) };

  for (const activity of runs) {
    const actuals = activityActuals(activity);
    const { date, startTime, durationMin } = activityPlacement(activity);

    // Imported before: refresh its numbers, leave everything else alone.
    // Every read here is scoped to this user through the session's plan, not
    // just by RLS, because background sync runs with the service-role client.
    const { data: existing } = await supabase
      .from("run_details")
      .select("session_id, sessions!inner(plans!inner(user_id))")
      .eq("strava_activity_id", actuals.strava_activity_id)
      .eq("sessions.plans.user_id", userId)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase.from("run_details").update(actuals).eq("session_id", existing.session_id);
      if (error) throw new Error(`Could not update a synced run: ${error.message}`);
      result.refreshed++;
      continue;
    }

    const { data: rows } = await supabase
      .from("sessions")
      .select("id, status, run_details!inner(run_type, strava_activity_id), plans!inner(user_id)")
      .eq("plans.user_id", userId)
      .eq("type", "run")
      .eq("planned_date", date)
      .neq("status", "skipped")
      .is("run_details.strava_activity_id", null);

    const candidates: Candidate[] = (rows ?? []).map((row) => {
      const details = Array.isArray(row.run_details) ? row.run_details[0] : row.run_details;
      return {
        id: row.id as string,
        status: row.status as string,
        run_type: ((details as { run_type?: RunType } | null)?.run_type ?? null),
      };
    });

    const match = pickPlannedRun(candidates, activity);
    if (match) {
      const { error } = await supabase.from("run_details").update(actuals).eq("session_id", match.id);
      if (error) throw new Error(`Could not save a synced run: ${error.message}`);
      await supabase.from("sessions").update({ status: "completed" }).eq("id", match.id);
      result.matched++;
      continue;
    }

    // Nothing was planned: file it as an ad-hoc run, so it still shows on
    // the calendar and counts in the history, but isn't conflict-checked.
    const planId = await findOrCreatePlanForDate(supabase, userId, date);
    const { data: session, error } = await supabase
      .from("sessions")
      .insert({
        plan_id: planId,
        type: "run",
        planned_date: date,
        planned_start_time: startTime,
        planned_duration_min: durationMin,
        status: "completed",
        ad_hoc: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Could not import a run: ${error.message}`);

    const { error: detailsError } = await supabase
      .from("run_details")
      .insert({ session_id: session.id, run_type: classifyRun(activity), ...actuals });
    if (detailsError) {
      // A session with no details would draw as a bare "Run" card forever.
      await supabase.from("sessions").delete().eq("id", session.id);
      throw new Error(`Could not import a run: ${detailsError.message}`);
    }
    result.created++;
  }

  await markSynced(supabase, userId, "strava");
  return result;
}
