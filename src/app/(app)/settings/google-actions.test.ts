import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sync: async (): Promise<{ upserted: number; removed: number }> => ({ upserted: 0, removed: 0 }),
  disconnect: async (): Promise<void> => {},
  revalidated: [] as string[],
}));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ supabase: {}, user: { id: "user-1" } }) }));
vi.mock("@/lib/settings", () => ({ getTimeZone: async () => "UTC" }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));
vi.mock("@/lib/google", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/google")>();
  return { ...real, syncGoogleCalendar: () => h.sync(), disconnectGoogle: () => h.disconnect() };
});

import { GoogleReconnectError } from "@/lib/google";
import { disconnectGoogleAction, syncGoogleNow } from "./google-actions";

beforeEach(() => {
  h.revalidated = [];
});

describe("syncGoogleNow", () => {
  it.each([
    [{ upserted: 1, removed: 0 }, "1 event synced."],
    [{ upserted: 12, removed: 3 }, "12 events synced, 3 removed."],
    [{ upserted: 0, removed: 0 }, "0 events synced."],
  ])("summarises %j", async (result, message) => {
    h.sync = async () => result;
    expect(await syncGoogleNow()).toEqual({ ok: true, message });
    expect(h.revalidated).toEqual(["/settings", "/week"]);
  });

  it("passes the reconnect message through as-is", async () => {
    h.sync = async () => {
      throw new GoogleReconnectError();
    };
    expect(await syncGoogleNow()).toEqual({ error: new GoogleReconnectError().message });
  });

  it("prefixes other failures", async () => {
    h.sync = async () => {
      throw new Error("Google Calendar request failed (500)");
    };
    expect(await syncGoogleNow()).toEqual({ error: "Sync failed: Google Calendar request failed (500)" });
  });
});

describe("disconnectGoogleAction", () => {
  it("disconnects", async () => {
    h.disconnect = async () => {};
    expect(await disconnectGoogleAction()).toEqual({ ok: true, message: "Google Calendar disconnected." });
  });

  it("reports failures without revalidating", async () => {
    h.disconnect = async () => {
      throw new Error("Couldn't remove synced events: denied");
    };
    expect(await disconnectGoogleAction()).toEqual({ error: "Disconnect failed: Couldn't remove synced events: denied" });
    expect(h.revalidated).toEqual([]);
  });
});
