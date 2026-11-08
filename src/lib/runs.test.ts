import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration } from "./runs";

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
