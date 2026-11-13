import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, type Call, type Responder } from "@/test/fake-supabase";

const h = vi.hoisted(() => ({
  client: null as unknown,
  user: { id: "user-1" } as { id: string } | null,
  exchange: null as null | (() => Promise<unknown>),
  syncError: null as Error | null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const c = h.client as Record<string, unknown>;
    return { ...c, auth: { getUser: async () => ({ data: { user: h.user } }) } };
  },
}));
vi.mock("@/lib/settings", () => ({ getTimeZone: async () => "UTC" }));
vi.mock("@/lib/google", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/google")>();
  return {
    ...real,
    exchangeCode: () => h.exchange!(),
    syncGoogleCalendar: async () => {
      if (h.syncError) throw h.syncError;
      return { upserted: 0, removed: 0 };
    },
  };
});

import { GET as start } from "./route";
import { GET as callback } from "./callback/route";
import { STATE_COOKIE } from "@/lib/google";

const ORIGIN = "https://protohybrid.test";
let calls: Call[];
function useDb(respond?: Responder) {
  const fake = fakeSupabase(respond);
  h.client = fake.client;
  calls = fake.calls;
}

function request(path: string, state?: string) {
  const req = new NextRequest(`${ORIGIN}${path}`);
  if (state) req.cookies.set(STATE_COOKIE, state);
  return req;
}
const goingTo = (res: Response) => res.headers.get("location");

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
  h.user = { id: "user-1" };
  h.syncError = null;
  h.exchange = async () => ({
    access_token: "acc",
    refresh_token: "ref",
    expires_in: 3600,
    scope: "openid email https://www.googleapis.com/auth/calendar.readonly",
  });
  useDb();
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/auth/google", () => {
  it("redirects to Google with offline access and a state cookie", async () => {
    const res = await start(request("/api/auth/google"));
    const url = new URL(goingTo(res)!);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/google/callback`);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("calendar.readonly");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${STATE_COOKIE}=${url.searchParams.get("state")}`);
    expect(cookie.toLowerCase()).toContain("httponly");
  });

  it("goes back to settings when Google isn't configured", async () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(goingTo(await start(request("/api/auth/google")))).toBe(`${ORIGIN}/settings?google=not_configured`);
  });
});

describe("GET /api/auth/google/callback", () => {
  const cb = (query: string, cookieState = "s1") => callback(request(`/api/auth/google/callback?${query}`, cookieState));

  it("stores tokens, syncs, and reports connected", async () => {
    const res = await cb("state=s1&code=abc");
    expect(goingTo(res)).toBe(`${ORIGIN}/settings?google=connected`);
    const upsert = calls.find((c) => c.op === "upsert")!;
    expect(upsert.options).toEqual({ onConflict: "user_id,provider" });
    expect(upsert.payload).toMatchObject({ user_id: "user-1", provider: "google", access_token: "acc", refresh_token: "ref" });
    // The one-time state cookie is cleared.
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${STATE_COOKIE}=;`));
  });

  it("rejects a missing or mismatched state (CSRF)", async () => {
    expect(goingTo(await cb("state=evil&code=abc"))).toBe(`${ORIGIN}/settings?google=error`);
    expect(goingTo(await callback(request("/api/auth/google/callback?state=s1&code=abc")))).toBe(`${ORIGIN}/settings?google=error`);
    expect(calls).toHaveLength(0);
  });

  it("reports a denied consent", async () => {
    expect(goingTo(await cb("state=s1&error=access_denied"))).toBe(`${ORIGIN}/settings?google=denied`);
  });

  it("refuses a grant without the calendar scope", async () => {
    h.exchange = async () => ({ access_token: "acc", scope: "openid email" });
    expect(goingTo(await cb("state=s1&code=abc"))).toBe(`${ORIGIN}/settings?google=missing_scope`);
    expect(calls.some((c) => c.op === "upsert")).toBe(false);
  });

  it("keeps the previous refresh token when Google doesn't send a new one", async () => {
    h.exchange = async () => ({ access_token: "acc2", scope: "https://www.googleapis.com/auth/calendar.readonly" });
    useDb((c) => (c.op === "select" ? { data: { refresh_token: "old-refresh" } } : undefined));
    await cb("state=s1&code=abc");
    expect(calls.find((c) => c.op === "upsert")!.payload).toMatchObject({ access_token: "acc2", refresh_token: "old-refresh" });
  });

  it("stays connected but says so when the first sync fails", async () => {
    h.syncError = new Error("boom");
    expect(goingTo(await cb("state=s1&code=abc"))).toBe(`${ORIGIN}/settings?google=sync_failed`);
  });

  it("reports token exchange failures", async () => {
    h.exchange = async () => {
      throw new Error("Google token exchange failed (400)");
    };
    expect(goingTo(await cb("state=s1&code=abc"))).toBe(`${ORIGIN}/settings?google=error`);
  });

  it("sends signed-out users to login", async () => {
    h.user = null;
    expect(goingTo(await cb("state=s1&code=abc"))).toBe(`${ORIGIN}/login`);
  });
});
