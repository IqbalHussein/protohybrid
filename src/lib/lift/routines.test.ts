import { describe, expect, it } from "vitest";
import { routineTargetsFromSets } from "./routines";

const s = (reps: number | null, set_type: "working" | "warmup" = "working") => ({ reps, set_type });

describe("routineTargetsFromSets", () => {
  it("counts working sets and takes the most common rep count", () => {
    // 5/5/5/3 was programmed as fives; an average would invent 4.5.
    expect(routineTargetsFromSets([s(5), s(5), s(5), s(3)])).toEqual({
      targetSets: 4,
      targetReps: 5,
    });
  });

  it("breaks a tie toward the higher rep count", () => {
    expect(routineTargetsFromSets([s(5), s(5), s(3), s(3)]).targetReps).toBe(5);
  });

  it("ignores warm-ups on both counts", () => {
    expect(routineTargetsFromSets([s(10, "warmup"), s(10, "warmup"), s(5)])).toEqual({
      targetSets: 1,
      targetReps: 5,
    });
  });

  it("has no targets when nothing but warm-ups were logged", () => {
    expect(routineTargetsFromSets([s(10, "warmup")])).toEqual({
      targetSets: null,
      targetReps: null,
    });
  });

  it("still reports a set count when no set recorded reps", () => {
    expect(routineTargetsFromSets([s(null), s(null)])).toEqual({
      targetSets: 2,
      targetReps: null,
    });
  });
});
