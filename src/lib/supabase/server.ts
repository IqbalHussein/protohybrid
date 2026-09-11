import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { cookies } from "next/headers";

// Use this client in Server Components, Server Actions, and Route Handlers.
export async function createClient() {
  const cookieStore = await cookies();

  // Annotated explicitly: `cookies` accepts a union of the current and
  // deprecated method shapes, so the callback params aren't contextually
  // typed without this and fall back to implicit `any`.
  const cookieMethods: CookieMethodsServer = {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      try {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options),
        );
      } catch {
        // Called from a Server Component — safe to ignore when you have
        // middleware refreshing sessions.
      }
    },
  };

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: cookieMethods },
  );
}
