import { describe, expect, it } from "vitest";
import { currentBests, sessionStats, totalVolume, type HistorySet, type StoredPr } from "./stats";

const set = (over: Partial<HistorySet> = {}): HistorySet => ({
  lift_details_id: "s1",
  exercise_id: "bench",
  weight: 100,
  reps: 10,
  set_type: "working",
  session_date: "2026-09-01",
  ...over,
});

describe("sessionStats", () => {
  it("collapses sets into one row per session, oldest first", () => {
    const stats = sessionStats([
      set({ lift_details_id: "s2", session_date: "2026-09-08", weight: 110 }),
      set(),
      set({ weight: 105 }),
    ]);

    expect(stats.map((s) => s.sessionId)).toEqual(["s1", "s2"]);
    expect(stats[0].workingSets).toBe(2);
    expect(stats[0].volume).toBe(2050);
    expect(stats[0].heaviestWeight).toBe(105);
  });

  it("excludes warm-ups from every aggregate", () => {
    const [stat] = sessionStats([set(), set({ weight: 300, set_type: "warmup" })]);
    expect(stat.workingSets).toBe(1);
    expect(stat.volume).toBe(1000);
    expect(stat.heaviestWeight).toBe(100);
  });

  it("keeps an all-warm-up session on the chart as a zero", () => {
    // Dropping it would close a gap in the progression that really happened.
    const stats = sessionStats([set({ set_type: "warmup" })]);
    expect(stats).toHaveLength(1);
    expect(stats[0].volume).toBe(0);
  });

  it("orders two workouts on the same day deterministically", () => {
    const stats = sessionStats([
      set({ lift_details_id: "b" }),
      set({ lift_details_id: "a" }),
    ]);
    expect(stats.map((s) => s.sessionId)).toEqual(["a", "b"]);
  });
});

describe("totalVolume", () => {
  it("sums working sets only", () => {
    expect(
      totalVolume([
        { weight: 100, reps: 10, set_type: "working" },
        { weight: 50, reps: 10, set_type: "warmup" },
        { weight: 80, reps: 8, set_type: "drop" },
      ]),
    ).toBe(1640);
  });
});

describe("currentBests", () => {
  const pr = (value: number, achieved_at: string): StoredPr => ({
    record_type: "heaviest_weight",
    value,
    weight: value,
    reps: 1,
    achieved_at,
  });

  it("picks the highest value, not the newest row", () => {
    const best = currentBests([pr(315, "2026-01-01"), pr(225, "2026-06-01")]);
    expect(best.heaviest_weight?.value).toBe(315);
  });

  it("credits a tie to the earlier row", () => {
    const best = currentBests([pr(315, "2026-06-01"), pr(315, "2026-01-01")]);
    expect(best.heaviest_weight?.achieved_at).toBe("2026-01-01");
  });

  it("keeps record types independent", () => {
    const best = currentBests([
      pr(315, "2026-01-01"),
      { record_type: "most_reps", value: 12, weight: 225, reps: 12, achieved_at: "2026-02-01" },
    ]);
    expect(best.heaviest_weight?.value).toBe(315);
    expect(best.most_reps?.value).toBe(12);
  });
});
