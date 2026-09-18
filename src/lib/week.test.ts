import { describe, expect, it } from "vitest";
import {
  addDays,
  addWeeks,
  currentWeekStart,
  formatDayHeading,
  formatWeekRange,
  isInWeek,
  isPast,
  isToday,
  mondayOf,
  parseDateString,
  toDateString,
  weekDates,
} from "./week";

describe("mondayOf", () => {
  it("returns the week's Monday for every day of it", () => {
    // 2026-09-14 is a Monday; 2026-09-20 is the Sunday that closes its week.
    for (const date of ["2026-09-14", "2026-09-17", "2026-09-20"]) {
      expect(mondayOf(date)).toBe("2026-09-14");
    }
  });

  it("sends Sunday back six days, not forward one", () => {
    expect(mondayOf("2026-09-20")).toBe("2026-09-14");
    expect(mondayOf("2026-09-21")).toBe("2026-09-21");
  });

  it("crosses a month and a year boundary", () => {
    expect(mondayOf("2026-01-01")).toBe("2025-12-29");
  });

  it("accepts a Date as well as a string", () => {
    expect(mondayOf(new Date(2026, 8, 17))).toBe("2026-09-14");
  });
});

describe("parseDateString", () => {
  it("parses as local midnight, not UTC midnight", () => {
    // new Date("2026-09-18") is UTC midnight, which is the 17th in Toronto —
    // the bug that renders a whole calendar one day out.
    const d = parseDateString("2026-09-18");
    expect(d.getDate()).toBe(18);
    expect(toDateString(d)).toBe("2026-09-18");
  });
});

describe("addDays", () => {
  it("crosses months, years and leap days", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("is unaffected by a daylight-saving change", () => {
    // DST starts 2026-03-08. Adding a day must not land back on the same date.
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });
});

describe("weekDates", () => {
  it("is seven days, Monday first", () => {
    const dates = weekDates("2026-09-14");
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-09-14");
    expect(dates[6]).toBe("2026-09-20");
  });

  it("spans a daylight-saving week without repeating or skipping a day", () => {
    expect(new Set(weekDates("2026-03-02")).size).toBe(7);
    expect(weekDates("2026-03-02")[6]).toBe("2026-03-08");
  });
});

describe("addWeeks", () => {
  it("moves whole weeks and stays on a Monday", () => {
    expect(addWeeks("2026-09-14", 1)).toBe("2026-09-21");
    expect(addWeeks("2026-09-14", -2)).toBe("2026-08-31");
  });
});

describe("isInWeek", () => {
  it("includes both ends and excludes the next Monday", () => {
    expect(isInWeek("2026-09-14", "2026-09-14")).toBe(true);
    expect(isInWeek("2026-09-20", "2026-09-14")).toBe(true);
    expect(isInWeek("2026-09-21", "2026-09-14")).toBe(false);
    expect(isInWeek("2026-09-13", "2026-09-14")).toBe(false);
  });
});

describe("isToday / isPast", () => {
  const now = new Date("2026-09-18T15:00:00Z");

  it("compares against the app's zone", () => {
    expect(isToday("2026-09-18", now)).toBe(true);
    expect(isPast("2026-09-17", now)).toBe(true);
    expect(isPast("2026-09-18", now)).toBe(false);
    expect(isPast("2026-09-19", now)).toBe(false);
  });
});

describe("currentWeekStart", () => {
  it("is the Monday of the local week", () => {
    expect(currentWeekStart(new Date("2026-09-18T15:00:00Z"))).toBe("2026-09-14");
    // Late Sunday evening locally is already Monday in UTC; the week must not
    // jump forward a day early.
    expect(currentWeekStart(new Date("2026-09-21T01:00:00Z"))).toBe("2026-09-14");
  });
});

describe("formatting", () => {
  it("heads a column with its weekday and date", () => {
    expect(formatDayHeading("2026-09-14")).toBe("Mon 14");
    expect(formatDayHeading("2026-09-20")).toBe("Sun 20");
  });

  it("collapses a shared month in the week range", () => {
    expect(formatWeekRange("2026-09-14")).toBe("Sep 14 – 20, 2026");
  });

  it("names both months when a week straddles them", () => {
    expect(formatWeekRange("2026-09-28")).toBe("Sep 28 – Oct 4, 2026");
  });
});
