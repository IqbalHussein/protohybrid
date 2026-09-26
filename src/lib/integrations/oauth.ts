import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Provider = "strava" | "google";

const STATE_COOKIE = (p: Provider) => `oauth_state_${p}`;

// CSRF protection for the OAuth round-trip: a random state value stored in a
// short-lived httpOnly cookie and echoed back by the provider.
export async function issueState(provider: Provider): Promise<string> {
  const state = randomBytes(16).toString("hex");
  (await cookies()).set(STATE_COOKIE(provider), state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return state;
}

export async function checkState(provider: Provider, state: string | null): Promise<boolean> {
  const store = await cookies();
  const expected = store.get(STATE_COOKIE(provider))?.value;
  store.delete(STATE_COOKIE(provider));
  return Boolean(expected && state && expected === state);
}

export function redirectUri(provider: Provider, origin: string): string {
  const fromEnv = provider === "strava" ? process.env.STRAVA_REDIRECT_URI : process.env.GOOGLE_REDIRECT_URI;
  return fromEnv || `${origin}/api/auth/${provider}/callback`;
}

export type Connection = {
  provider: Provider;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  external_account_name: string | null;
  last_synced_at: string | null;
};

export async function getConnection(supabase: SupabaseClient, provider: Provider): Promise<Connection | null> {
  const { data } = await supabase
    .from("oauth_connections")
    .select("provider, access_token, refresh_token, expires_at, external_account_name, last_synced_at")
    .eq("provider", provider)
    .maybeSingle();
  return data;
}

// Returns a usable access token, refreshing (and persisting) it first if it
// expires within the next minute.
export async function freshAccessToken(
  supabase: SupabaseClient,
  userId: string,
  conn: Connection,
  refresh: (refreshToken: string) => Promise<{ access_token: string; refresh_token?: string; expires_at: Date }>,
): Promise<string> {
  const expires = conn.expires_at ? new Date(conn.expires_at).getTime() : Infinity;
  if (expires - Date.now() > 60_000) return conn.access_token;
  if (!conn.refresh_token) throw new Error(`Your ${conn.provider} connection expired. Reconnect it in Settings.`);

  const t = await refresh(conn.refresh_token);
  await supabase
    .from("oauth_connections")
    .update({
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? conn.refresh_token,
      expires_at: t.expires_at.toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", conn.provider);
  return t.access_token;
}

export async function postForm(url: string, body: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${new URL(url).host} returned ${res.status}: ${json.message ?? json.error_description ?? json.error ?? "error"}`);
  }
  return json;
}
