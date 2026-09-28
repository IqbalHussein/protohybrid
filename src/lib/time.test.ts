import { describe, expect, it } from "vitest";
import {
  APP_TIME_ZONE,
  formatMinutes,
  formatTimeOfDay,
  minutesIntoDay,
  minutesToTimeString,
  timeStringToMinutes,
  todayInZone,
  zonedDateString,
  zonedToUtc,
} from "./time";

// Toronto is UTC-4 in summer (EDT) and UTC-5 in winter (EST). Every case below
// is chosen so a naive UTC implementation would give a visibly wrong answer.
describe("zonedDateString", () => {
  it("names the local day, not the UTC one", () => {
    // 01:30 UTC on the 19th is still 21:30 on the 18th in Toronto — the
    // off-by-one that would render Friday's session on Saturday.
    expect(zonedDateString(new Date("2026-09-19T01:30:00Z"))).toBe("2026-09-18");
  });

  it("handles the winter offset too", () => {
    expect(zonedDateString(new Date("2026-01-05T04:30:00Z"))).toBe("2026-01-04");
  });
});

describe("minutesIntoDay", () => {
  it("counts from local midnight", () => {
    expect(minutesIntoDay(new Date("2026-09-18T10:30:00Z"))).toBe(6 * 60 + 30);
  });

  it("returns 0 at local midnight rather than 1440", () => {
    expect(minutesIntoDay(new Date("2026-09-18T04:00:00Z"))).toBe(0);
  });
});

describe("zonedToUtc", () => {
  it("resolves a summer wall-clock time at UTC-4", () => {
    expect(zonedToUtc("2026-09-18", "06:30").toISOString()).toBe("2026-09-18T10:30:00.000Z");
  });

  it("resolves a winter wall-clock time at UTC-5", () => {
    expect(zonedToUtc("2026-01-15", "06:30").toISOString()).toBe("2026-01-15T11:30:00.000Z");
  });

  it("defaults to local midnight", () => {
    expect(zonedToUtc("2026-09-18").toISOString()).toBe("2026-09-18T04:00:00.000Z");
  });

  it("round-trips through the local day it names", () => {
    for (const date of ["2026-03-08", "2026-11-01", "2026-06-21"]) {
      expect(zonedDateString(zonedToUtc(date, "12:00"))).toBe(date);
    }
  });

  it("resolves the hour after a spring-forward gap, which has no 2:30am", () => {
    // DST starts 2026-03-08; 02:30 local does not exist. Either side of the
    // jump is defensible, but it must be a real instant on that date.
    const resolved = zonedToUtc("2026-03-08", "02:30");
    expect(Number.isNaN(resolved.getTime())).toBe(false);
    expect(zonedDateString(resolved)).toBe("2026-03-08");
  });
});

describe("minutesToTimeString / timeStringToMinutes", () => {
  it("round-trips", () => {
    expect(timeStringToMinutes(minutesToTimeString(395))).toBe(395);
  });

  it("reads the HH:MM:SS Postgres returns for a time column", () => {
    expect(timeStringToMinutes("06:30:00")).toBe(390);
  });

  it("has no time when the column is null", () => {
    expect(timeStringToMinutes(null)).toBeNull();
  });

  it("clamps rather than wrapping past the end of the day", () => {
    expect(minutesToTimeString(24 * 60)).toBe("23:59");
  });
});

describe("formatTimeOfDay", () => {
  it("renders noon and midnight as 12, not 0", () => {
    expect(formatTimeOfDay(0)).toBe("12:00 am");
    expect(formatTimeOfDay(12 * 60)).toBe("12:00 pm");
  });

  it("renders ordinary times", () => {
    expect(formatTimeOfDay(6 * 60 + 5)).toBe("6:05 am");
    expect(formatTimeOfDay(18 * 60 + 30)).toBe("6:30 pm");
  });
});

describe("formatMinutes", () => {
  it("drops a zero minute remainder", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(120)).toBe("2h");
  });
});

describe("todayInZone", () => {
  it("is the app's zone, not the runtime's", () => {
    expect(APP_TIME_ZONE).toBe("America/Toronto");
    expect(todayInZone(new Date("2026-09-19T02:00:00Z"))).toBe("2026-09-18");
  });
});
