import { describe, expect, it } from "vitest";
import { shouldStartRest, supersetLabels, supersetMembers } from "./supersets";

// Bench and row are supersetted; squat is logged on its own after them.
const workout = [
  { exerciseId: "bench", supersetGroup: "g1" },
  { exerciseId: "row", supersetGroup: "g1" },
  { exerciseId: "squat", supersetGroup: null },
];

describe("supersetMembers", () => {
  it("lists a group in workout order", () => {
    expect(supersetMembers(workout, "g1")).toEqual(["bench", "row"]);
  });

  it("has no members without a group", () => {
    expect(supersetMembers(workout, null)).toEqual([]);
  });
});

describe("shouldStartRest", () => {
  it("never rests after a warm-up", () => {
    expect(shouldStartRest("warmup", "squat", workout)).toBe(false);
  });

  it("rests after an ungrouped working set", () => {
    expect(shouldStartRest("working", "squat", workout)).toBe(true);
  });

  it("holds rest until the last exercise of a superset", () => {
    expect(shouldStartRest("working", "bench", workout)).toBe(false);
    expect(shouldStartRest("working", "row", workout)).toBe(true);
  });

  it("treats a group of one as an ordinary exercise", () => {
    expect(shouldStartRest("working", "bench", [{ exerciseId: "bench", supersetGroup: "g1" }])).toBe(true);
  });

  it("rests after drop and failure sets, which are working sets", () => {
    expect(shouldStartRest("drop", "squat", workout)).toBe(true);
    expect(shouldStartRest("failure", "squat", workout)).toBe(true);
  });
});

describe("supersetLabels", () => {
  it("letters groups in the order they first appear", () => {
    const labels = supersetLabels([
      ...workout,
      { exerciseId: "curl", supersetGroup: "g2" },
      { exerciseId: "pushdown", supersetGroup: "g2" },
    ]);
    expect(labels.get("g1")).toBe("A");
    expect(labels.get("g2")).toBe("B");
    expect(labels.size).toBe(2);
  });
});
