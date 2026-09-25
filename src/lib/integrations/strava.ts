import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunType } from "@/lib/conflicts";
import { findOrCreatePlan } from "@/lib/plans";
import { freshAccessToken, getConnection, postForm } from "./oauth";

// Strava sync (project-spec.md MVP #3): pulls completed runs and either fills
// in the actuals of the matching planned run or files them as ad-hoc runs.

const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const API = "https://www.strava.com/api/v3";
const RUN_SPORTS = new Set(["Run", "TrailRun", "VirtualRun"]);

export function stravaConfigured(): boolean {
  return Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
}

export function stravaAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
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
  return postForm(TOKEN_URL, {
    client_id: process.env.STRAVA_CLIENT_ID!,
    client_secret: process.env.STRAVA_CLIENT_SECRET!,
    code,
    grant_type: "authorization_code",
  });
}

async function refreshStrava(refreshToken: string) {
  const t: TokenResponse = await postForm(TOKEN_URL, {
    client_id: process.env.STRAVA_CLIENT_ID!,
    client_secret: process.env.STRAVA_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: new Date(t.expires_at * 1000) };
}

export async function revokeStrava(accessToken: string) {
  await fetch("https://www.strava.com/oauth/deauthorize", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => undefined);
}

export type StravaActivity = {
  id: number;
  name: string;
  sport_type?: string;
  type: string;
  workout_type?: number | null;
  start_date: string; // UTC
  start_date_local: string; // athlete's wall clock, mislabelled with a Z
  distance: number; // metres
  moving_time: number; // seconds
  average_heartrate?: number;
  total_elevation_gain?: number;
};

// Strava's run workout_type: 1 = race, 2 = long run, 3 = workout.
export function classifyRun(a: StravaActivity): RunType {
  if (a.workout_type === 1) return "race";
  if (a.workout_type === 2) return "long";
  if (a.workout_type === 3) return "interval";
  return "easy";
}

export function activityActuals(a: StravaActivity) {
  const km = a.distance / 1000;
  return {
    actual_distance_km: Math.round(km * 100) / 100,
    actual_duration_sec: a.moving_time,
    actual_pace_sec_per_km: km > 0 ? Math.round(a.moving_time / km) : null,
    actual_avg_hr: a.average_heartrate ?? null,
    actual_elevation_m: a.total_elevation_gain ?? null,
    actual_started_at: a.start_date,
    strava_activity_id: String(a.id),
    strava_name: a.name,
  };
}

async function fetchActivities(token: string, afterEpoch: number): Promise<StravaActivity[]> {
  const out: StravaActivity[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${API}/athlete/activities?after=${afterEpoch}&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 429) throw new Error("Strava rate limit reached — try again in 15 minutes.");
    if (!res.ok) throw new Error(`Strava returned ${res.status}`);
    const batch: StravaActivity[] = await res.json();
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out.filter((a) => RUN_SPORTS.has(a.sport_type ?? a.type));
}

export async function syncStrava(supabase: SupabaseClient, userId: string) {
  const conn = await getConnection(supabase, "strava");
  if (!conn) throw new Error("Strava isn't connected.");
  const token = await freshAccessToken(supabase, userId, conn, refreshStrava);

  // Re-read a few days before the last sync so edits made on Strava shortly
  // after an activity (title, workout type) still come through.
  const since = conn.last_synced_at
    ? new Date(new Date(conn.last_synced_at).getTime() - 3 * 86_400_000)
    : new Date(Date.now() - 30 * 86_400_000);
  const activities = await fetchActivities(token, Math.floor(since.getTime() / 1000));

  let matched = 0;
  let created = 0;
  let updated = 0;

  for (const a of activities) {
    const actuals = activityActuals(a);
    const date = a.start_date_local.slice(0, 10);
    const time = a.start_date_local.slice(11, 16);

    // Already imported: refresh its numbers.
    const { data: existing } = await supabase
      .from("run_details")
      .select("session_id")
      .eq("strava_activity_id", actuals.strava_activity_id)
      .maybeSingle();
    if (existing) {
      await supabase.from("run_details").update(actuals).eq("session_id", existing.session_id);
      updated++;
      continue;
    }

    // A planned run that day without an activity yet: this is it. Prefer one
    // whose run type matches Strava's classification.
    const { data: candidates } = await supabase
      .from("sessions")
      .select("id, run_details!inner(run_type, strava_activity_id)")
      .eq("type", "run")
      .eq("planned_date", date)
      .neq("status", "skipped")
      .is("run_details.strava_activity_id", null);
    const list = candidates ?? [];
    const kind = classifyRun(a);
    const match =
      list.find((c) => {
        const d = Array.isArray(c.run_details) ? c.run_details[0] : c.run_details;
        return (d as { run_type?: string } | null)?.run_type === kind;
      }) ?? list[0];

    if (match) {
      await supabase.from("run_details").update(actuals).eq("session_id", match.id);
      await supabase.from("sessions").update({ status: "completed" }).eq("id", match.id);
      matched++;
      continue;
    }

    // Unplanned run: file it as an ad-hoc session so it still shows on the
    // calendar and in the week's totals.
    const planId = await findOrCreatePlan(supabase, userId, date);
    const { data: session, error } = await supabase
      .from("sessions")
      .insert({ plan_id: planId, type: "run", planned_date: date, planned_time: time, status: "completed", ad_hoc: true })
      .select("id")
      .single();
    if (error) throw new Error(`Could not import run: ${error.message}`);
    await supabase.from("run_details").insert({ session_id: session.id, run_type: kind, ...actuals });
    created++;
  }

  await supabase
    .from("oauth_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("provider", "strava");

  return { total: activities.length, matched, created, updated, since: since.toISOString().slice(0, 10) };
}
