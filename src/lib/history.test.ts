import { describe, expect, it } from "vitest";
import { mergeHistory } from "./history";

const d = (date: string, id = date) => ({ date, id });

describe("mergeHistory", () => {
  it("interleaves lifts and runs newest first", () => {
    const { entries, complete } = mergeHistory([d("2026-09-10"), d("2026-09-01")], [d("2026-09-05")], 10);
    expect(entries.map((e) => `${e.kind}:${e.item.date}`)).toEqual([
      "lift:2026-09-10",
      "run:2026-09-05",
      "lift:2026-09-01",
    ]);
    expect(complete).toBe(true);
  });

  it("stops where a full list may be missing older entries", () => {
    // Runs came back full (limit 2), so anything before Sep 20 might be missing
    // runs; the lift from Sep 1 is left out rather than shown beside a gap.
    const { entries, complete, since } = mergeHistory(
      [d("2026-09-22"), d("2026-09-01")],
      [d("2026-09-25"), d("2026-09-20")],
      2,
    );
    expect(entries.map((e) => e.item.date)).toEqual(["2026-09-25", "2026-09-22", "2026-09-20"]);
    expect(complete).toBe(false);
    expect(since).toBe("2026-09-20");
  });

  it("uses the later cutoff when both lists are full", () => {
    const { since } = mergeHistory([d("2026-09-22"), d("2026-09-15")], [d("2026-09-25"), d("2026-09-18")], 2);
    expect(since).toBe("2026-09-18");
  });

  it("handles no history", () => {
    expect(mergeHistory([], [], 10)).toEqual({ entries: [], complete: true, since: null });
  });
});
