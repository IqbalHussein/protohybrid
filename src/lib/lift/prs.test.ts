import { describe, expect, it } from "vitest";
import { findPrs, type PrCandidate, type PrSet } from "./prs";
import type { PrRecordType } from "./types";

const bench = (weight: number | null, reps: number | null, set_type: PrSet["set_type"] = "working") => ({
  exercise_id: "bench",
  exercise_name: "Bench Press",
  weight,
  reps,
  set_type,
});

const types = (hits: { record_type: PrRecordType }[]) => hits.map((h) => h.record_type).sort();

describe("findPrs", () => {
  it("fires the three history-free records on a first-ever working set", () => {
    // most_reps is absent by design: with no prior set at that weight there is
    // nothing to have beaten.
    expect(types(findPrs([bench(135, 5)], []))).toEqual([
      "best_e1rm",
      "best_volume",
      "heaviest_weight",
    ]);
  });

  it("returns nothing when the session is all warm-ups", () => {
    expect(findPrs([bench(135, 5, "warmup")], [])).toEqual([]);
  });

  it("ignores prior warm-ups when computing the bar to beat", () => {
    const prior: PrSet[] = [{ exercise_id: "bench", weight: 315, reps: 1, set_type: "warmup" }];
    const hits = findPrs([bench(225, 5)], prior);
    expect(types(hits)).toContain("heaviest_weight");
  });

  it("does not fire when the session only matches history", () => {
    const prior: PrSet[] = [{ exercise_id: "bench", weight: 225, reps: 5, set_type: "working" }];
    expect(findPrs([bench(225, 5)], prior)).toEqual([]);
  });

  it("flags most_reps only once that exact weight has been lifted before", () => {
    const prior: PrSet[] = [{ exercise_id: "bench", weight: 225, reps: 5, set_type: "working" }];

    const sameWeight = findPrs([bench(225, 7)], prior);
    expect(types(sameWeight)).toContain("most_reps");

    // 230 has never been touched, so there is no rep record at 230 to break.
    const newWeight = findPrs([bench(230, 7)], prior);
    expect(types(newWeight)).not.toContain("most_reps");
  });

  it("keeps the best single hit per exercise and record type", () => {
    const hits = findPrs([bench(225, 5), bench(245, 3), bench(235, 4)], []);
    const heaviest = hits.filter((h) => h.record_type === "heaviest_weight");
    expect(heaviest).toHaveLength(1);
    expect(heaviest[0].value).toBe(245);
  });

  it("separates records by exercise", () => {
    const squat: PrCandidate = {
      exercise_id: "squat",
      exercise_name: "Squat",
      weight: 315,
      reps: 5,
      set_type: "working",
    };
    const prior: PrSet[] = [{ exercise_id: "bench", weight: 405, reps: 5, set_type: "working" }];

    // The heavy bench history must not suppress the squat's first record.
    const hits = findPrs([squat], prior);
    expect(hits.every((h) => h.exercise_id === "squat")).toBe(true);
    expect(types(hits)).toContain("heaviest_weight");
  });

  it("skips sets with no weight or no rep count", () => {
    expect(findPrs([bench(null, 10), bench(135, null)], [])).toEqual([]);
  });

  it("flags a volume PR from a lighter, longer set without claiming an e1RM", () => {
    // 185x12 is 2220 lb against the prior 1125, but Epley puts it at 259
    // against 262.5 — the records are genuinely independent.
    const prior: PrSet[] = [{ exercise_id: "bench", weight: 225, reps: 5, set_type: "working" }];
    expect(types(findPrs([bench(185, 12)], prior))).toEqual(["best_volume"]);
  });
});
