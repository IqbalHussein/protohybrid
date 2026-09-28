import { describe, expect, it } from "vitest";
import {
  countsAsWork,
  estimated1RM,
  formatDuration,
  formatSeconds,
  roundTo,
  setVolume,
} from "./math";

describe("countsAsWork", () => {
  it("excludes warm-ups and counts everything else", () => {
    expect(countsAsWork("warmup")).toBe(false);
    expect(countsAsWork("working")).toBe(true);
    // Drop and failure sets are real work, per the 0002 migration's note.
    expect(countsAsWork("drop")).toBe(true);
    expect(countsAsWork("failure")).toBe(true);
  });
});

describe("setVolume", () => {
  it("multiplies weight by reps", () => {
    expect(setVolume(185, 5)).toBe(925);
  });

  it("is zero when either side is missing, rather than NaN", () => {
    expect(setVolume(null, 5)).toBe(0);
    expect(setVolume(185, null)).toBe(0);
  });
});

describe("estimated1RM", () => {
  it("applies Epley", () => {
    expect(estimated1RM(100, 10)).toBeCloseTo(133.333, 3);
  });

  it("returns the weight itself for a single", () => {
    expect(estimated1RM(225, 1)).toBeCloseTo(232.5, 3);
  });

  it("is zero for missing or non-positive reps", () => {
    expect(estimated1RM(225, 0)).toBe(0);
    expect(estimated1RM(null, 5)).toBe(0);
    expect(estimated1RM(225, null)).toBe(0);
  });
});

describe("formatDuration", () => {
  it("renders minutes under an hour and h+m above", () => {
    const start = "2026-09-18T10:00:00.000Z";
    expect(formatDuration(start, "2026-09-18T10:45:00.000Z")).toBe("45m");
    expect(formatDuration(start, "2026-09-18T11:30:00.000Z")).toBe("1h 30m");
  });

  it("has no duration without a start", () => {
    expect(formatDuration(null, "2026-09-18T11:30:00.000Z")).toBe("—");
  });

  it("measures an unfinished workout against now", () => {
    const start = new Date(Date.now() - 20 * 60_000).toISOString();
    expect(formatDuration(start, null)).toBe("20m");
  });
});

describe("formatSeconds", () => {
  it("pads seconds", () => {
    expect(formatSeconds(125)).toBe("2:05");
    expect(formatSeconds(60)).toBe("1:00");
  });

  it("clamps an overrun at zero instead of printing a negative", () => {
    expect(formatSeconds(-3)).toBe("0:00");
  });
});

describe("roundTo", () => {
  it("keeps real half-pound plates and drops float noise", () => {
    expect(roundTo(102.5)).toBe(102.5);
    expect(roundTo(133.33333)).toBe(133.3);
  });
});
