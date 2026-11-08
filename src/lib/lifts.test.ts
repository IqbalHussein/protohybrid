import { describe, expect, it } from "vitest";
import { e1rm, groupByExercise, isUuid, parseLiftPayload, parseRoutinePayload, sessionVolume } from "./lifts";

const SQUAT = "11111111-0000-0000-0000-000000000001";
const BENCH = "11111111-0000-0000-0000-000000000002";

const payload = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    sessionId: null,
    date: "2026-11-03",
    focus: "legs",
    notes: "",
    groups: [{ exerciseId: SQUAT, sets: [{ setType: "working", reps: "5", weight: "225", rpe: "" }] }],
    ...overrides,
  });

describe("e1rm", () => {
  it("matches the SQL Epley rule", () => {
    expect(e1rm(205, 5)).toBe(239.2);
    expect(e1rm(215, 3)).toBe(236.5);
    expect(e1rm(100, 1)).toBe(103.3);
    expect(e1rm(100, 12)).toBe(140);
  });
  it("is undefined outside 1–12 reps or without weight", () => {
    expect(e1rm(100, 13)).toBeNull();
    expect(e1rm(100, 0)).toBeNull();
    expect(e1rm(0, 5)).toBeNull();
    expect(e1rm(null, 5)).toBeNull();
  });
});

describe("volume and grouping", () => {
  it("counts only working and failure sets, like the best-volume PR", () => {
    expect(
      sessionVolume([
        { set_type: "warmup", weight: 135, reps: 5 },
        { set_type: "working", weight: 225, reps: 5 },
        { set_type: "drop", weight: 185, reps: 8 },
        { set_type: "working", weight: null, reps: 10 },
      ]),
    ).toBe(225 * 5);
  });
  it("groups by first appearance", () => {
    const g = groupByExercise([
      { exercise_id: "b", n: 1 },
      { exercise_id: "a", n: 2 },
      { exercise_id: "b", n: 3 },
    ]);
    expect(g.map((x) => x.exercise_id)).toEqual(["b", "a"]);
    expect(g[0].sets.map((s) => s.n)).toEqual([1, 3]);
  });
});

describe("parseLiftPayload", () => {
  it("keeps an untouched stored weight exactly (no rounding drift)", () => {
    const groups = (weight: string) => [
      { exerciseId: SQUAT, sets: [{ setType: "working", reps: "5", weight, rpe: "", original: { shown: "102.1", lb: 225 } }] },
    ];
    const kept = parseLiftPayload(payload({ groups: groups("102.1") }), "kg");
    expect(kept.ok && kept.value.sets[0].weight).toBe(225);
    const changed = parseLiftPayload(payload({ groups: groups("105") }), "kg");
    expect(changed.ok && changed.value.sets[0].weight).toBeCloseTo(231.485, 3);
  });

  it("parses a valid lift in lb", () => {
    const r = parseLiftPayload(payload(), "lb");
    expect(r).toEqual({
      ok: true,
      value: {
        sessionId: null,
        date: "2026-11-03",
        focus: "legs",
        notes: null,
        sets: [{ exercise_id: SQUAT, set_type: "working", reps: 5, weight: 225, rpe: null }],
      },
    });
  });

  it("converts kg to stored lb", () => {
    const r = parseLiftPayload(
      payload({ groups: [{ exerciseId: SQUAT, sets: [{ setType: "working", reps: "5", weight: "100", rpe: "8.5" }] }] }),
      "kg",
    );
    expect(r.ok && r.value.sets[0]).toEqual({ exercise_id: SQUAT, set_type: "working", reps: 5, weight: 220.462, rpe: 8.5 });
  });

  it("skips empty rows and empty groups", () => {
    const r = parseLiftPayload(
      payload({
        groups: [
          { exerciseId: null, sets: [{ setType: "working", reps: "", weight: "", rpe: "" }] },
          {
            exerciseId: BENCH,
            sets: [
              { setType: "working", reps: "", weight: "", rpe: "" },
              { setType: "warmup", reps: "10", weight: "", rpe: "" },
            ],
          },
        ],
      }),
      "lb",
    );
    expect(r.ok && r.value.sets).toEqual([{ exercise_id: BENCH, set_type: "warmup", reps: 10, weight: null, rpe: null }]);
  });

  it.each([
    [{ date: "2026-02-30" }, "Pick a date"],
    [{ focus: "  " }, "Choose a focus"],
    [{ groups: [] }, "Add at least one set"],
    [{ groups: [{ exerciseId: null, sets: [{ setType: "working", reps: "5", weight: "", rpe: "" }] }] }, "choose an exercise"],
    [{ groups: [{ exerciseId: SQUAT, sets: [{ setType: "working", reps: "5.5", weight: "", rpe: "" }] }] }, "reps must be a whole number"],
    [{ groups: [{ exerciseId: SQUAT, sets: [{ setType: "working", reps: "5", weight: "-5", rpe: "" }] }] }, "weight must be 0 or more"],
    [{ groups: [{ exerciseId: SQUAT, sets: [{ setType: "working", reps: "5", weight: "abc", rpe: "" }] }] }, "weight must be 0 or more"],
    [{ groups: [{ exerciseId: SQUAT, sets: [{ setType: "working", reps: "5", weight: "", rpe: "11" }] }] }, "RPE must be"],
    [{ groups: [{ exerciseId: SQUAT, sets: [{ setType: "bogus", reps: "5", weight: "", rpe: "" }] }] }, "set type"],
    [{ groups: [{ exerciseId: SQUAT, sets: [{ setType: "working", reps: "5", weight: "6000", rpe: "" }] }] }, "too high"],
    [{ sessionId: "nope" }, "can't be found"],
  ])("rejects %j", (overrides, fragment) => {
    const r = parseLiftPayload(payload(overrides), "lb");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(fragment);
  });

  it("rejects unreadable payloads", () => {
    expect(parseLiftPayload("{nope", "lb").ok).toBe(false);
    expect(parseLiftPayload(null, "lb").ok).toBe(false);
  });
});

describe("parseRoutinePayload", () => {
  it("parses targets and blanks", () => {
    const r = parseRoutinePayload(
      JSON.stringify({
        routineId: null,
        name: " Leg day ",
        exercises: [
          { exerciseId: SQUAT, targetSets: "5", targetReps: "5" },
          { exerciseId: BENCH, targetSets: "", targetReps: "" },
        ],
      }),
    );
    expect(r).toEqual({
      ok: true,
      value: {
        routineId: null,
        name: "Leg day",
        exercises: [
          { exercise_id: SQUAT, target_sets: 5, target_reps: 5 },
          { exercise_id: BENCH, target_sets: null, target_reps: null },
        ],
      },
    });
  });

  it("rejects bad routines", () => {
    expect(parseRoutinePayload(JSON.stringify({ routineId: null, name: "", exercises: [] })).ok).toBe(false);
    expect(parseRoutinePayload(JSON.stringify({ routineId: null, name: "A", exercises: [] })).ok).toBe(false);
    expect(
      parseRoutinePayload(JSON.stringify({ routineId: null, name: "A", exercises: [{ exerciseId: SQUAT, targetSets: "0", targetReps: "" }] })).ok,
    ).toBe(false);
  });
});

it("isUuid", () => {
  expect(isUuid(SQUAT)).toBe(true);
  expect(isUuid("x")).toBe(false);
  expect(isUuid(null)).toBe(false);
});
