import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { UserClient } from "@/lib/auth";

/**
 * The parts of the Strava and Google OAuth flows that are the same for both:
 * CSRF state, the stored connection, and refreshing an expired token.
 */

export type Provider = "strava" | "google";

export const PROVIDER_NAMES: Record<Provider, string> = {
  strava: "Strava",
  google: "Google Calendar",
};

const stateCookie = (provider: Provider) => `oauth_state_${provider}`;

/**
 * A random value the provider echoes back on the callback. Kept in a
 * short-lived httpOnly cookie, so a callback that didn't start from this
 * browser — a forged link connecting someone else's account — is refused.
 */
export async function issueState(provider: Provider): Promise<string> {
  const state = randomBytes(16).toString("hex");
  (await cookies()).set(stateCookie(provider), state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return state;
}

/** Single use: the cookie is cleared whether or not it matched. */
export async function checkState(provider: Provider, state: string | null): Promise<boolean> {
  const store = await cookies();
  const expected = store.get(stateCookie(provider))?.value;
  store.delete(stateCookie(provider));
  return Boolean(expected && state && expected === state);
}

/** Must match the redirect URI registered with the provider exactly, hence the env override. */
export function redirectUri(provider: Provider, origin: string): string {
  const configured = provider === "strava" ? process.env.STRAVA_REDIRECT_URI : process.env.GOOGLE_REDIRECT_URI;
  return configured || `${origin}/api/auth/${provider}/callback`;
}

export type Connection = {
  provider: Provider;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  external_account_name: string | null;
  last_synced_at: string | null;
  /** Google only: the calendars to import; null until the user chooses (see 0008). */
  calendar_ids: string[] | null;
};

/**
 * A user's connection to a provider. Filtered by user explicitly rather than
 * trusting RLS alone: background sync runs with the service-role client, which
 * bypasses RLS, and would otherwise read whichever user's row came first.
 */
export async function getConnection(
  supabase: UserClient,
  userId: string,
  provider: Provider,
): Promise<Connection | null> {
  const { data } = await supabase
    .from("oauth_connections")
    .select("provider, access_token, refresh_token, expires_at, external_account_name, last_synced_at, calendar_ids")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  return (data as Connection | null) ?? null;
}

export type RefreshedToken = { access_token: string; refresh_token?: string; expires_at: Date };

/** A usable access token, refreshed and saved first if it expires within the next minute. */
export async function freshAccessToken(
  supabase: UserClient,
  userId: string,
  connection: Connection,
  refresh: (refreshToken: string) => Promise<RefreshedToken>,
): Promise<string> {
  const expires = connection.expires_at ? new Date(connection.expires_at).getTime() : Infinity;
  if (expires - Date.now() > 60_000) return connection.access_token;

  if (!connection.refresh_token) {
    throw new Error(`Your ${PROVIDER_NAMES[connection.provider]} connection expired. Reconnect it in Settings.`);
  }

  const token = await refresh(connection.refresh_token);
  const { error } = await supabase
    .from("oauth_connections")
    .update({
      access_token: token.access_token,
      // Google omits the refresh token on refresh; the old one stays valid.
      refresh_token: token.refresh_token ?? connection.refresh_token,
      expires_at: token.expires_at.toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", connection.provider);
  if (error) throw new Error(`Could not save the refreshed token: ${error.message}`);

  return token.access_token;
}

export async function markSynced(supabase: UserClient, userId: string, provider: Provider) {
  await supabase
    .from("oauth_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("provider", provider);
}

/** POST a form to a token endpoint, turning an error response into a readable Error. */
export async function postForm<T>(url: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = json.message ?? json.error_description ?? json.error ?? "error";
    throw new Error(`${new URL(url).host} returned ${res.status}: ${reason}`);
  }
  return json as T;
}
