import { describe, expect, it } from "vitest";
import { formatDistance, formatDuration, formatPace, parseDuration, runTypeLabel } from "./runs";

describe("durations", () => {
  it.each([
    ["45:30", 2730],
    ["1:05:09", 3909],
    ["90:00", 5400],
    [" 10:05 ", 605],
    ["0:00", null],
    ["5:60", null],
    ["1:60:00", null],
    ["abc", null],
    ["1:2:3:4", null],
    ["-1:00", null],
    ["1.5:00", null],
  ])("parses %j", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it("formats", () => {
    expect(formatDuration(2730)).toBe("45:30");
    expect(formatDuration(3909)).toBe("1:05:09");
    expect(formatDuration(305)).toBe("5:05");
  });
});

describe("run formatting", () => {
  it("round-trips durations", () => {
    for (const sec of [1, 59, 60, 3599, 3600, 3661, 36000]) expect(parseDuration(formatDuration(sec))).toBe(sec);
  });

  it("formats pace per km", () => {
    expect(formatPace(300)).toBe("5:00");
    expect(formatPace(304)).toBe("5:04");
  });

  it("formats distance to at most 2 decimals", () => {
    expect(formatDistance(10)).toBe("10");
    expect(formatDistance(10.2)).toBe("10.2");
    expect(formatDistance(21.0975)).toBe("21.1");
    expect(formatDistance(5.005)).toBe("5.01");
  });

  it("labels run types", () => {
    expect(runTypeLabel("tempo")).toBe("Tempo");
    expect(runTypeLabel("")).toBe("");
  });
});
