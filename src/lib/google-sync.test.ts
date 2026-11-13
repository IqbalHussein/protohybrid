import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, filterValue, type Call, type Responder } from "@/test/fake-supabase";
import { GoogleReconnectError, disconnectGoogle, getValidAccessToken, listEvents, syncGoogleCalendar } from "./google";

// Network and database paths of the Google integration, with fetch and the
// Supabase client faked.

const USER = "user-1";
const NOW = new Date("2026-11-03T12:00:00Z");

type FetchCall = { url: string; init: RequestInit };
let fetchCalls: FetchCall[];
let fetchQueue: (Response | Error)[];

function queueFetch(...responses: (Response | Error)[]) {
  fetchQueue.push(...responses);
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const connection = (extra: Record<string, unknown> = {}) => ({
  user_id: USER,
  provider: "google",
  access_token: "stored-access",
  refresh_token: "stored-refresh",
  expires_at: "2026-11-03T13:00:00Z",
  scope: null,
  ...extra,
});

let calls: Call[];
function db(respond: Responder) {
  const fake = fakeSupabase(respond);
  calls = fake.calls;
  return fake.client;
}
const connResponder =
  (conn: object | null, extra?: Responder): Responder =>
  (c) =>
    c.table === "oauth_connections" && c.op === "select" ? { data: conn } : extra?.(c);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
  fetchCalls = [];
  fetchQueue = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    const next = fetchQueue.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    if (next instanceof Error) throw next;
    return next;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getValidAccessToken", () => {
  it("returns the stored token while it is fresh", async () => {
    expect(await getValidAccessToken(db(connResponder(connection())), USER)).toBe("stored-access");
    expect(fetchCalls).toHaveLength(0);
  });

  it("refreshes an expiring token and saves the new one", async () => {
    queueFetch(json({ access_token: "new-access", expires_in: 3600 }));
    const client = db(connResponder(connection({ expires_at: "2026-11-03T12:00:30Z" })));
    expect(await getValidAccessToken(client, USER)).toBe("new-access");
    const body = new URLSearchParams(String(fetchCalls[0].init.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("stored-refresh");
    const update = calls.find((c) => c.op === "update")!;
    // No refresh_token in the response, so the stored one is kept.
    expect(update.payload).toEqual({ access_token: "new-access", expires_at: "2026-11-03T13:00:00.000Z" });
  });

  it("drops the connection and asks to reconnect on invalid_grant", async () => {
    queueFetch(json({ error: "invalid_grant" }, 400));
    const client = db(connResponder(connection({ expires_at: null })));
    await expect(getValidAccessToken(client, USER)).rejects.toBeInstanceOf(GoogleReconnectError);
    expect(calls.some((c) => c.table === "oauth_connections" && c.op === "delete")).toBe(true);
  });

  it("keeps the connection on other refresh failures", async () => {
    queueFetch(json({ error: "server_error" }, 503));
    const client = db(connResponder(connection({ expires_at: null })));
    await expect(getValidAccessToken(client, USER)).rejects.toThrow("Google token refresh failed (503: server_error)");
    expect(calls.some((c) => c.op === "delete")).toBe(false);
  });

  it("asks to reconnect when there's no connection or no refresh token", async () => {
    await expect(getValidAccessToken(db(connResponder(null)), USER)).rejects.toBeInstanceOf(GoogleReconnectError);
    const client = db(connResponder(connection({ expires_at: null, refresh_token: null })));
    await expect(getValidAccessToken(client, USER)).rejects.toBeInstanceOf(GoogleReconnectError);
    expect(calls.some((c) => c.op === "delete")).toBe(true);
  });
});

describe("listEvents", () => {
  const min = new Date("2026-10-20T00:00:00Z");
  const max = new Date("2026-12-28T00:00:00Z");

  it("follows page tokens and sends the bearer token", async () => {
    queueFetch(json({ items: [{ id: "a" }], nextPageToken: "p2" }), json({ items: [{ id: "b" }] }));
    const events = await listEvents("tok", min, max);
    expect(events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(new URL(fetchCalls[1].url).searchParams.get("pageToken")).toBe("p2");
    expect(new URL(fetchCalls[0].url).searchParams.get("singleEvents")).toBe("true");
    expect((fetchCalls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("maps 401 to a reconnect error and other failures to a plain error", async () => {
    queueFetch(new Response("", { status: 401 }));
    await expect(listEvents("tok", min, max)).rejects.toBeInstanceOf(GoogleReconnectError);
    queueFetch(new Response("", { status: 500 }));
    await expect(listEvents("tok", min, max)).rejects.toThrow("Google Calendar request failed (500)");
  });

  it("refuses to return a partial list when pages never end", async () => {
    for (let i = 0; i < 40; i++) queueFetch(json({ items: [], nextPageToken: `p${i}` }));
    await expect(listEvents("tok", min, max)).rejects.toThrow("too many events");
  });
});

describe("syncGoogleCalendar", () => {
  it("upserts busy events, prunes stale ones, and stamps last_synced_at", async () => {
    queueFetch(
      json({
        items: [
          { id: "keep", summary: "Work", start: { dateTime: "2026-11-04T14:00:00Z" }, end: { dateTime: "2026-11-04T22:00:00Z" } },
          { id: "allday", start: { date: "2026-11-05" }, end: { date: "2026-11-06" } },
        ],
      }),
    );
    const client = db(
      connResponder(connection(), (c) =>
        c.table === "busy_blocks" && c.op === "select"
          ? { data: [{ id: "row-keep", google_event_id: "keep" }, { id: "row-gone", google_event_id: "gone" }] }
          : undefined,
      ),
    );

    expect(await syncGoogleCalendar(client, USER, "America/New_York")).toEqual({ upserted: 1, removed: 1 });

    const upsert = calls.find((c) => c.op === "upsert")!;
    expect(upsert.options).toEqual({ onConflict: "user_id,google_event_id" });
    expect(upsert.payload).toEqual([
      {
        google_event_id: "keep",
        title: "Work",
        start_time: "2026-11-04T14:00:00.000Z",
        end_time: "2026-11-04T22:00:00.000Z",
        user_id: USER,
        source: "google_calendar",
      },
    ]);
    const listed = calls.find((c) => c.table === "busy_blocks" && c.op === "select")!;
    expect(filterValue(listed, "eq", "source")).toBe("google_calendar");
    const del = calls.find((c) => c.table === "busy_blocks" && c.op === "delete")!;
    expect(filterValue(del, "in", "id")).toEqual(["row-gone"]);
    const stamp = calls.find((c) => c.table === "oauth_connections" && c.op === "update")!;
    expect(stamp.payload).toEqual({ last_synced_at: NOW.toISOString() });
  });

  it("changes nothing when Google fails", async () => {
    queueFetch(new Response("", { status: 500 }));
    const client = db(connResponder(connection()));
    await expect(syncGoogleCalendar(client, USER, "UTC")).rejects.toThrow();
    expect(calls.filter((c) => c.op !== "select")).toEqual([]);
  });

  it("stops before pruning if saving events fails", async () => {
    queueFetch(json({ items: [{ id: "a", start: { dateTime: "2026-11-04T14:00:00Z" }, end: { dateTime: "2026-11-04T15:00:00Z" } }] }));
    const client = db(connResponder(connection(), (c) => (c.op === "upsert" ? { error: { message: "denied" } } : undefined)));
    await expect(syncGoogleCalendar(client, USER, "UTC")).rejects.toThrow("Couldn't save calendar events: denied");
    expect(calls.some((c) => c.op === "delete")).toBe(false);
  });
});

describe("disconnectGoogle", () => {
  it("revokes the refresh token, then deletes synced blocks before the connection", async () => {
    queueFetch(new Response("", { status: 200 }));
    const client = db(connResponder(connection()));
    await disconnectGoogle(client, USER);
    expect(new URLSearchParams(String(fetchCalls[0].init.body)).get("token")).toBe("stored-refresh");
    const deletes = calls.filter((c) => c.op === "delete").map((c) => c.table);
    expect(deletes).toEqual(["busy_blocks", "oauth_connections"]);
    expect(filterValue(calls.find((c) => c.table === "busy_blocks")!, "eq", "source")).toBe("google_calendar");
  });

  it("still disconnects locally when revocation fails", async () => {
    queueFetch(new Error("offline"));
    const client = db(connResponder(connection()));
    await disconnectGoogle(client, USER);
    expect(calls.filter((c) => c.op === "delete")).toHaveLength(2);
  });

  it("keeps the connection if synced blocks can't be removed", async () => {
    queueFetch(new Response("", { status: 200 }));
    const client = db(connResponder(connection(), (c) => (c.op === "delete" ? { error: { message: "denied" } } : undefined)));
    await expect(disconnectGoogle(client, USER)).rejects.toThrow("Couldn't remove synced events: denied");
    expect(calls.filter((c) => c.op === "delete").map((c) => c.table)).toEqual(["busy_blocks"]);
  });
});
