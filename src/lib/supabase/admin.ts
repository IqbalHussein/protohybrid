import { createClient } from "@supabase/supabase-js";
import type { UserClient } from "@/lib/auth";

/**
 * A service-role client for work that runs without a signed-in user: the
 * Strava webhook and the scheduled sync. It bypasses RLS, so everything it
 * runs must filter by user itself — which is why the sync functions take a
 * userId and scope every read with it.
 *
 * Server-only: SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix, so Next
 * never ships it to the browser, and nothing client-side imports this file.
 */
export function createAdminClient(): UserClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Background sync needs SUPABASE_SERVICE_ROLE_KEY.");

  // Same client shape the user-bound one has; the sync code is written against it.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as UserClient;
}

export function adminConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
