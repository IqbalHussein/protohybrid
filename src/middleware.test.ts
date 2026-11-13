import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ user: null as { id: string } | null, exchangeError: null as { message: string } | null }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: async () => ({ error: h.exchangeError }) } }),
}));

import { middleware } from "./middleware";
import { GET as authCallback } from "./app/auth/callback/route";

const ORIGIN = "https://protohybrid.test";
const at = (path: string) => new NextRequest(`${ORIGIN}${path}`);

beforeEach(() => {
  h.user = null;
  h.exchangeError = null;
});

describe("middleware", () => {
  it.each(["/", "/week", "/lifts/log?session=x", "/settings", "/api/auth/google"])("sends signed-out %s to /login", async (path) => {
    const res = await middleware(at(path));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login`);
  });

  it.each(["/login", "/auth/callback?code=x"])("lets signed-out visitors reach %s", async (path) => {
    const res = await middleware(at(path));
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets signed-in users through", async () => {
    h.user = { id: "u" };
    expect((await middleware(at("/week"))).headers.get("location")).toBeNull();
  });
});

describe("GET /auth/callback", () => {
  it("signs in with the code and opens the week", async () => {
    expect((await authCallback(at("/auth/callback?code=abc"))).headers.get("location")).toBe(`${ORIGIN}/week`);
  });

  it("returns to login with an error for bad or missing codes", async () => {
    expect((await authCallback(at("/auth/callback"))).headers.get("location")).toBe(`${ORIGIN}/login?error=link`);
    h.exchangeError = { message: "expired" };
    expect((await authCallback(at("/auth/callback?code=abc"))).headers.get("location")).toBe(`${ORIGIN}/login?error=link`);
  });
});
