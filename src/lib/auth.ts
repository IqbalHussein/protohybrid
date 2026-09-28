import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user plus a Supabase client bound to their session.
 *
 * Every query in the app runs as that user with RLS enforced, so queries do
 * not filter by user_id explicitly — the policies do it. Middleware already
 * redirects anonymous requests, so a missing user here is a programming error
 * rather than a normal state, and throwing is correct.
 */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, user };
}

/** A Supabase client already bound to the signed-in user, for helper functions. */
export type UserClient = Awaited<ReturnType<typeof requireUser>>["supabase"];
