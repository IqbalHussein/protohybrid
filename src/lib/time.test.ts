import { describe, expect, it } from "vitest";
import {
  addDays,
  diffDays,
  formatWeekRange,
  isValidDate,
  isoWeekday,
  parseTime,
  resolveTimeZone,
  todayIn,
  weekDays,
  weekStart,
  zonedParts,
  zonedToUtc,
} from "./time";

describe("calendar dates", () => {
  it("validates real dates only", () => {
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("2026-1-01")).toBe(false);
  });

  it("adds days across month, year and DST boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(diffDays("2026-11-01", "2026-11-08")).toBe(7);
  });

  it("finds Monday week starts", () => {
    expect(isoWeekday("2026-11-02")).toBe(1);
    expect(isoWeekday("2026-11-08")).toBe(7);
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
    expect(weekDays("2026-11-02")).toEqual([
      "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08",
    ]);
  });

  it("formats week ranges", () => {
    expect(formatWeekRange("2026-11-02")).toBe("2–8 Nov 2026");
    expect(formatWeekRange("2026-10-26")).toBe("26 Oct – 1 Nov 2026");
    expect(formatWeekRange("2026-12-28")).toBe("28 Dec 2026 – 3 Jan 2027");
  });
});

describe("times and zones", () => {
  it("parses HH:MM and HH:MM:SS", () => {
    expect(parseTime("07:30")).toBe(450);
    expect(parseTime("23:59:00")).toBe(1439);
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("7:30")).toBeNull();
    expect(parseTime(null)).toBeNull();
  });

  it("falls back to UTC for bad zones", () => {
    expect(resolveTimeZone("America/New_York")).toBe("America/New_York");
    expect(resolveTimeZone("Not/AZone")).toBe("UTC");
    expect(resolveTimeZone(undefined)).toBe("UTC");
  });

  it("gives the local date of an instant", () => {
    const instant = new Date("2026-11-03T03:30:00Z");
    expect(todayIn("UTC", instant)).toBe("2026-11-03");
    expect(todayIn("America/Los_Angeles", instant)).toBe("2026-11-02");
    expect(zonedParts(instant, "Asia/Kolkata")).toEqual({ date: "2026-11-03", minutes: 9 * 60 });
  });

  it("converts wall time to UTC, including across DST", () => {
    expect(zonedToUtc("2026-11-03", "09:00", "America/New_York").toISOString()).toBe("2026-11-03T14:00:00.000Z");
    expect(zonedToUtc("2026-07-03", "09:00", "America/New_York").toISOString()).toBe("2026-07-03T13:00:00.000Z");
    // US DST ends 2026-11-01 02:00; 01:30 is ambiguous, either answer is a real 01:30.
    const ambiguous = zonedToUtc("2026-11-01", "01:30", "America/New_York");
    expect(zonedParts(ambiguous, "America/New_York")).toEqual({ date: "2026-11-01", minutes: 90 });
    // Spring-forward gap (02:30 doesn't exist on 2026-03-08) lands just after the gap.
    const gap = zonedParts(zonedToUtc("2026-03-08", "02:30", "America/New_York"), "America/New_York");
    expect(gap.date).toBe("2026-03-08");
    expect(gap.minutes).toBe(3 * 60 + 30);
    expect(zonedToUtc("2026-11-03", "09:00", "UTC").toISOString()).toBe("2026-11-03T09:00:00.000Z");
  });
});
