import { describe, expect, it } from "vitest";
import {
  emailFromIdToken,
  eventsToBusyBlocks,
  expiresAtFrom,
  hasCalendarScope,
  needsRefresh,
  syncWindow,
  type GoogleEvent,
} from "./google";

const timed = (id: string, start: string, end: string, extra: Partial<GoogleEvent> = {}): GoogleEvent => ({
  id,
  summary: `Event ${id}`,
  start: { dateTime: start },
  end: { dateTime: end },
  ...extra,
});

describe("eventsToBusyBlocks", () => {
  it("maps timed events to UTC ISO blocks", () => {
    expect(eventsToBusyBlocks([timed("a", "2026-11-03T09:00:00-05:00", "2026-11-03T10:30:00-05:00")])).toEqual([
      {
        google_event_id: "a",
        title: "Event a",
        start_time: "2026-11-03T14:00:00.000Z",
        end_time: "2026-11-03T15:30:00.000Z",
      },
    ]);
  });

  it("skips all-day, cancelled, free, declined and zero-length events", () => {
    const events: GoogleEvent[] = [
      { id: "allday", start: { date: "2026-11-03" }, end: { date: "2026-11-04" } },
      timed("cancelled", "2026-11-03T09:00:00Z", "2026-11-03T10:00:00Z", { status: "cancelled" }),
      timed("free", "2026-11-03T09:00:00Z", "2026-11-03T10:00:00Z", { transparency: "transparent" }),
      timed("declined", "2026-11-03T09:00:00Z", "2026-11-03T10:00:00Z", {
        attendees: [{ self: true, responseStatus: "declined" }],
      }),
      timed("zero", "2026-11-03T09:00:00Z", "2026-11-03T09:00:00Z"),
      timed("backwards", "2026-11-03T10:00:00Z", "2026-11-03T09:00:00Z"),
      timed("garbage", "not a date", "2026-11-03T09:00:00Z"),
      { summary: "no id", start: { dateTime: "2026-11-03T09:00:00Z" }, end: { dateTime: "2026-11-03T10:00:00Z" } },
    ];
    expect(eventsToBusyBlocks(events)).toEqual([]);
  });

  it("keeps events others declined, defaults the title, and de-duplicates ids", () => {
    const blocks = eventsToBusyBlocks([
      timed("x", "2026-11-03T09:00:00Z", "2026-11-03T10:00:00Z", {
        summary: "  ",
        attendees: [{ self: false, responseStatus: "declined" }, { self: true, responseStatus: "accepted" }],
      }),
      timed("x", "2026-11-03T11:00:00Z", "2026-11-03T12:00:00Z"),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe("Busy");
  });
});

describe("token helpers", () => {
  const now = new Date("2026-11-03T12:00:00Z");

  it("refreshes when missing, expired, or within the skew", () => {
    expect(needsRefresh(null, now)).toBe(true);
    expect(needsRefresh("garbage", now)).toBe(true);
    expect(needsRefresh("2026-11-03T11:59:00Z", now)).toBe(true);
    expect(needsRefresh("2026-11-03T12:00:59Z", now)).toBe(true);
    expect(needsRefresh("2026-11-03T12:05:00Z", now)).toBe(false);
  });

  it("computes expiry from expires_in", () => {
    expect(expiresAtFrom(3600, now)).toBe("2026-11-03T13:00:00.000Z");
    expect(expiresAtFrom(undefined, now)).toBeNull();
  });

  it("reads email from an id_token payload", () => {
    const payload = Buffer.from(JSON.stringify({ email: "me@example.com" })).toString("base64url");
    expect(emailFromIdToken(`h.${payload}.s`)).toBe("me@example.com");
    expect(emailFromIdToken("h.@@@.s")).toBeNull();
    expect(emailFromIdToken(undefined)).toBeNull();
  });

  it("checks the calendar scope was granted", () => {
    expect(hasCalendarScope("openid https://www.googleapis.com/auth/calendar.readonly email")).toBe(true);
    expect(hasCalendarScope("openid email")).toBe(false);
    expect(hasCalendarScope(null)).toBe(false);
  });
});

describe("syncWindow", () => {
  it("spans local midnight 14 days back to 56 days ahead", () => {
    const { timeMin, timeMax } = syncWindow("America/New_York", new Date("2026-11-03T03:00:00Z"));
    // Local today is 2026-11-02 (EST, UTC-5).
    expect(timeMin.toISOString()).toBe("2026-10-19T04:00:00.000Z"); // EDT before DST ended
    expect(timeMax.toISOString()).toBe("2026-12-28T05:00:00.000Z");
  });
});
