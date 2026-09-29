import { timingSafeEqual } from "node:crypto";

/**
 * The pure parts of background sync: reading Strava's webhook events and
 * checking the scheduler's credentials. Kept free of Supabase so they test
 * without a database.
 */

/**
 * A Strava push event. Strava sends one per activity create/update/delete and
 * one when an athlete revokes the app; `owner_id` is the athlete, which is
 * what `oauth_connections.external_account_id` stores.
 */
export type StravaEvent = {
  object_type?: string;
  aspect_type?: string;
  object_id?: number;
  owner_id?: number;
  updates?: Record<string, string>;
};

export type StravaEventAction =
  | { kind: "sync"; athleteId: string }
  | { kind: "deauthorize"; athleteId: string }
  | { kind: "ignore" };

/**
 * What to do about an event. A new or edited activity triggers a sync, which
 * also refreshes an already-imported run. A deleted activity is ignored: the
 * run stays in the training history, the same as it does when Strava is
 * disconnected.
 */
export function stravaEventAction(event: StravaEvent): StravaEventAction {
  if (event.owner_id == null) return { kind: "ignore" };
  const athleteId = String(event.owner_id);

  if (event.object_type === "athlete" && event.updates?.authorized === "false") {
    return { kind: "deauthorize", athleteId };
  }
  if (event.object_type === "activity" && (event.aspect_type === "create" || event.aspect_type === "update")) {
    return { kind: "sync", athleteId };
  }
  return { kind: "ignore" };
}

/** Constant-time compare, so the secret can't be guessed a character at a time from response timing. */
export function secretMatches(given: string | null | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. */
export function cronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  return secretMatches(token, secret);
}
