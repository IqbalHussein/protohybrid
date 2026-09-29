import { describe, expect, it } from "vitest";
import { achievedAt } from "./records";

describe("achievedAt", () => {
  it("uses the finish time when it falls on the session's date", () => {
    expect(achievedAt("2026-09-16", "2026-09-16T22:15:00Z")).toBe("2026-09-16T22:15:00Z");
  });

  it("uses midday on the session's date for a moved or backfilled workout", () => {
    // Finished on the 20th, but the session is dated the 16th: 12:00 Toronto.
    expect(achievedAt("2026-09-16", "2026-09-20T22:15:00Z")).toBe("2026-09-16T16:00:00.000Z");
    expect(achievedAt("2026-09-16", null)).toBe("2026-09-16T16:00:00.000Z");
  });

  it("compares dates in the app's zone, not UTC", () => {
    // 01:30 UTC on the 17th is still the evening of the 16th in Toronto.
    expect(achievedAt("2026-09-16", "2026-09-17T01:30:00Z")).toBe("2026-09-17T01:30:00Z");
  });
});
