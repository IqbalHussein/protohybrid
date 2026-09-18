import { describe, expect, it } from "vitest";
import {
  formatDistance,
  formatPace,
  formatRunDuration,
  minutesToSeconds,
  paceFrom,
  parsePace,
  secondsToMinutes,
} from "./runs";

describe("paceFrom", () => {
  it("is seconds per km", () => {
    expect(paceFrom(10, 3300)).toBe(330);
  });

  it("has no pace without both numbers", () => {
    expect(paceFrom(null, 3300)).toBeNull();
    expect(paceFrom(10, null)).toBeNull();
    expect(paceFrom(0, 3300)).toBeNull();
  });
});

describe("parsePace", () => {
  it("reads m:ss", () => {
    expect(parsePace("5:30")).toBe(330);
    expect(parsePace("4:05")).toBe(245);
  });

  it("reads a bare number of minutes", () => {
    expect(parsePace("5")).toBe(300);
  });

  it("reads a larger bare number as seconds already", () => {
    expect(parsePace("330")).toBe(330);
  });

  it("is null for blank or nonsense", () => {
    expect(parsePace("")).toBeNull();
    expect(parsePace(null)).toBeNull();
    expect(parsePace("fast")).toBeNull();
  });

  it("round-trips through formatPace", () => {
    expect(formatPace(parsePace("5:30"))).toBe("5:30 /km");
  });
});

describe("formatPace", () => {
  it("pads the seconds", () => {
    expect(formatPace(305)).toBe("5:05 /km");
  });

  it("has nothing to show for a missing pace", () => {
    expect(formatPace(null)).toBeNull();
    expect(formatPace(0)).toBeNull();
  });
});

describe("formatDistance", () => {
  it("drops trailing zeros, which read as false precision on a plan", () => {
    expect(formatDistance(10)).toBe("10 km");
    expect(formatDistance(10.5)).toBe("10.5 km");
    expect(formatDistance(10.25)).toBe("10.25 km");
  });

  it("shows a zero distance rather than hiding it", () => {
    expect(formatDistance(0)).toBe("0 km");
    expect(formatDistance(null)).toBeNull();
  });
});

describe("formatRunDuration", () => {
  it("renders minutes and hours", () => {
    expect(formatRunDuration(2700)).toBe("45m");
    expect(formatRunDuration(4320)).toBe("1h 12m");
    expect(formatRunDuration(7200)).toBe("2h");
  });

  it("has nothing to show for a missing duration", () => {
    expect(formatRunDuration(null)).toBeNull();
  });
});

describe("minutesToSeconds / secondsToMinutes", () => {
  it("round-trips", () => {
    expect(secondsToMinutes(minutesToSeconds(45))).toBe(45);
  });

  it("treats blank and zero as no value", () => {
    expect(minutesToSeconds(null)).toBeNull();
    expect(minutesToSeconds(0)).toBeNull();
    expect(secondsToMinutes(null)).toBeNull();
  });
});
