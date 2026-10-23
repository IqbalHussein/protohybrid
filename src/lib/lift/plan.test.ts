import { describe, expect, it } from "vitest";
import { comparePlan, formatDone, formatTarget, type DoneSet, type PlannedExercise } from "./plan";

const squat: PlannedExercise = { exerciseId: "sq", name: "Squat", targetSets: 3, targetReps: 5 };
const bench: PlannedExercise = { exerciseId: "bp", name: "Bench", targetSets: 3, targetReps: 8 };

function sets(exerciseId: string, name: string, reps: (number | null)[], setType: DoneSet["set_type"] = "working") {
  return reps.map((r) => ({ exerciseId, name, reps: r, set_type: setType }));
}

describe("comparePlan", () => {
  it("puts each exercise's target beside what was done", () => {
    const rows = comparePlan([squat], sets("sq", "Squat", [5, 5, 5]));
    expect(rows).toEqual([{ exerciseId: "sq", name: "Squat", planned: "3 × 5", done: "3 × 5", status: "met" }]);
  });

  it("is short on missing sets or reps", () => {
    expect(comparePlan([squat], sets("sq", "Squat", [5, 5]))[0]).toMatchObject({ done: "2 × 5", status: "short" });
    expect(comparePlan([squat], sets("sq", "Squat", [5, 5, 3]))[0]).toMatchObject({
      done: "3 sets: 5, 5, 3",
      status: "short",
    });
  });

  it("doesn't count warm-ups", () => {
    const logged = [...sets("sq", "Squat", [10, 8], "warmup"), ...sets("sq", "Squat", [5, 5])];
    expect(comparePlan([squat], logged)[0]).toMatchObject({ done: "2 × 5", status: "short" });
  });

  it("counts drop and failure sets as work", () => {
    const logged = [...sets("sq", "Squat", [5, 5]), ...sets("sq", "Squat", [6], "failure")];
    expect(comparePlan([squat], logged)[0].status).toBe("met");
  });

  it("isn't undone by an extra back-off set below the target reps", () => {
    expect(comparePlan([squat], sets("sq", "Squat", [5, 5, 5, 3]))[0].status).toBe("met");
  });

  it("marks planned exercises never logged as skipped, and unplanned ones as added", () => {
    const rows = comparePlan([squat, bench], [...sets("dl", "Deadlift", [5]), ...sets("sq", "Squat", [5, 5, 5])]);
    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ["Squat", "met"],
      ["Bench", "skipped"],
      ["Deadlift", "added"],
    ]);
    expect(rows[1]).toMatchObject({ planned: "3 × 8", done: null });
    expect(rows[2]).toMatchObject({ planned: null, done: "1 × 5" });
  });

  it("holds an exercise only to the targets the routine set", () => {
    const setsOnly = { ...squat, targetReps: null };
    const repsOnly = { ...squat, targetSets: null };
    expect(comparePlan([setsOnly], sets("sq", "Squat", [3, 4, 2]))[0].status).toBe("met");
    expect(comparePlan([repsOnly], sets("sq", "Squat", [5]))[0].status).toBe("met");
    expect(comparePlan([repsOnly], sets("sq", "Squat", [5, 4]))[0].status).toBe("short");
  });

  it("treats a set with no reps recorded as short of a rep target", () => {
    expect(comparePlan([squat], sets("sq", "Squat", [5, 5, null]))[0]).toMatchObject({
      done: "3 sets: 5, 5, —",
      status: "short",
    });
  });
});

describe("formatTarget", () => {
  it("reads sets × reps, or whichever was set", () => {
    expect(formatTarget(3, 5)).toBe("3 × 5");
    expect(formatTarget(3, null)).toBe("3 sets");
    expect(formatTarget(1, null)).toBe("1 set");
    expect(formatTarget(null, 8)).toBe("× 8");
    expect(formatTarget(null, null)).toBeNull();
  });
});

describe("formatDone", () => {
  it("collapses uniform sets and lists uneven ones", () => {
    expect(formatDone([5, 5, 5])).toBe("3 × 5");
    expect(formatDone([8, 6])).toBe("2 sets: 8, 6");
    expect(formatDone([null])).toBe("1 set: —");
    expect(formatDone([])).toBeNull();
  });
});
