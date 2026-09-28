import { describe, expect, it } from "vitest";
import { isBusy, toBusyBlock, type GoogleEvent } from "./google";

function event(over: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: "e1",
    status: "confirmed",
    summary: "Lecture",
    start: { dateTime: "2026-09-16T09:00:00-04:00" },
    end: { dateTime: "2026-09-16T11:00:00-04:00" },
    ...over,
  };
}

describe("isBusy", () => {
  it("keeps an ordinary timed event", () => {
    expect(isBusy(event())).toBe(true);
  });

  it("skips all-day events", () => {
    expect(isBusy(event({ start: { date: "2026-09-16" }, end: { date: "2026-09-17" } }))).toBe(false);
  });

  it("skips events marked free, cancelled, or declined", () => {
    expect(isBusy(event({ transparency: "transparent" }))).toBe(false);
    expect(isBusy(event({ status: "cancelled" }))).toBe(false);
    expect(isBusy(event({ attendees: [{ self: true, responseStatus: "declined" }] }))).toBe(false);
  });

  it("keeps an invite the user accepted or hasn't answered", () => {
    expect(isBusy(event({ attendees: [{ self: true, responseStatus: "accepted" }] }))).toBe(true);
    expect(isBusy(event({ attendees: [{ self: true, responseStatus: "needsAction" }] }))).toBe(true);
    expect(isBusy(event({ attendees: [{ self: false, responseStatus: "declined" }] }))).toBe(true);
  });

  it("skips a zero-length event, which busy_blocks would reject", () => {
    expect(isBusy(event({ end: { dateTime: "2026-09-16T09:00:00-04:00" } }))).toBe(false);
  });
});

describe("toBusyBlock", () => {
  it("stores instants in UTC and names untitled events", () => {
    expect(toBusyBlock(event({ summary: "  " }))).toEqual({
      title: "Busy",
      start_time: "2026-09-16T13:00:00.000Z",
      end_time: "2026-09-16T15:00:00.000Z",
    });
  });
});
