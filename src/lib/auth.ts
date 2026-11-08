import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// For Server Components and Server Actions that need the signed-in user.
// Middleware already redirects signed-out visitors; this is the typed guard.
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}
