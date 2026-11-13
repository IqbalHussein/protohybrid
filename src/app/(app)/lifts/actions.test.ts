import { beforeEach, describe, expect, it, vi } from "vitest";
import { RedirectError, fakeSupabase, filterValue, formData, type Call, type Responder } from "@/test/fake-supabase";

const h = vi.hoisted(() => ({ client: null as unknown, revalidated: [] as string[] }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ supabase: h.client, user: { id: "user-1" } }) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));
vi.mock("next/navigation", async () => {
  const { RedirectError } = await import("@/test/fake-supabase");
  return {
    redirect: (url: string) => {
      throw new RedirectError(url);
    },
  };
});

import { createCustomExercise, deleteLift, deleteRoutine, logLift, saveRestPref, saveRoutine, setLiftStatus } from "./actions";

const SESSION = "3f2a1b4c-0000-4000-8000-000000000001";
const SQUAT = "3f2a1b4c-0000-4000-8000-0000000000a1";
let calls: Call[];

function useDb(respond?: Responder) {
  const fake = fakeSupabase(respond);
  h.client = fake.client;
  calls = fake.calls;
}

// Settings row with the given unit; log_lift returns SESSION.
const withUnit =
  (unit: "lb" | "kg", extra?: Responder): Responder =>
  (c) => {
    if (c.table === "user_settings") return { data: { user_id: "user-1", weight_unit: unit, conflict_rules_seeded: true } };
    if (c.rpc === "log_lift") return { data: SESSION };
    return extra?.(c);
  };

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RedirectError) return e.url;
    throw e;
  }
  throw new Error("expected a redirect");
}

const payload = (weight: string, extra: object = {}) =>
  formData({
    payload: JSON.stringify({
      sessionId: null,
      date: "2026-11-03",
      focus: "legs",
      notes: "",
      groups: [{ exerciseId: SQUAT, sets: [{ setType: "working", reps: "5", weight, rpe: "" }] }],
      ...extra,
    }),
  });

beforeEach(() => {
  h.revalidated = [];
  useDb();
});

describe("logLift", () => {
  it("saves sets in lb and redirects to the lift", async () => {
    useDb(withUnit("lb"));
    expect(await redirectOf(logLift({}, payload("225")))).toBe(`/lifts/${SESSION}`);
    const rpc = calls.find((c) => c.rpc === "log_lift")!;
    expect(rpc.payload).toEqual({
      p_session_id: null,
      p_date: "2026-11-03",
      p_focus: "legs",
      p_notes: null,
      p_sets: [{ exercise_id: SQUAT, set_type: "working", reps: 5, weight: 225, rpe: null }],
    });
    expect(h.revalidated).toEqual(expect.arrayContaining(["/lifts", "/week", `/lifts/${SESSION}`]));
  });

  it("converts kg entries to stored lb using the server-side setting", async () => {
    useDb(withUnit("kg"));
    await redirectOf(logLift({}, payload("100")));
    const sets = (calls.find((c) => c.rpc === "log_lift")!.payload as { p_sets: { weight: number }[] }).p_sets;
    expect(sets[0].weight).toBeCloseTo(220.462, 2);
  });

  it("returns parse errors without calling the database RPC", async () => {
    useDb(withUnit("lb"));
    expect(await logLift({}, payload("-5"))).toEqual({ error: "Exercise 1, set 1: weight must be 0 or more." });
    expect(await logLift({}, formData({ payload: "{" }))).toEqual({
      error: "The form couldn't be read. Reload and try again.",
    });
    expect(calls.some((c) => c.rpc)).toBe(false);
  });

  it("reports RPC errors", async () => {
    useDb((c) =>
      c.table === "user_settings"
        ? { data: { user_id: "user-1", weight_unit: "lb", conflict_rules_seeded: true } }
        : c.rpc === "log_lift"
          ? { error: { message: "Lift not found" } }
          : undefined,
    );
    expect(await logLift({}, payload("225"))).toEqual({ error: "Lift not saved: Lift not found" });
  });
});

describe("createCustomExercise", () => {
  it("normalises whitespace and inserts a custom exercise", async () => {
    useDb((c) => (c.op === "insert" ? { data: { id: "new", name: "Zercher Squat", muscle_group: null, equipment: null, is_custom: true } } : { data: [] }));
    const res = await createCustomExercise("  Zercher   Squat ");
    expect(res).toEqual({ exercise: expect.objectContaining({ id: "new", name: "Zercher Squat" }) });
    const insert = calls.find((c) => c.op === "insert")!;
    expect(insert.payload).toEqual({ name: "Zercher Squat", is_custom: true, user_id: "user-1" });
  });

  it("returns an existing exercise with the same name instead of duplicating", async () => {
    useDb(() => ({ data: [{ id: "built-in", name: "Barbell Squat", muscle_group: "quadriceps", equipment: null, is_custom: false }] }));
    expect(await createCustomExercise("barbell squat")).toEqual({ exercise: expect.objectContaining({ id: "built-in" }) });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("escapes LIKE wildcards so 50% doesn't match everything", async () => {
    useDb((c) => (c.op === "insert" ? { data: { id: "n", name: "50%_*\\", is_custom: true } } : { data: [{ id: "x", name: "5000 Row" }] }));
    await createCustomExercise("50%_*\\");
    expect(filterValue(calls[0], "ilike", "name")).toBe("50____");
    expect(calls.some((c) => c.op === "insert")).toBe(true);
  });

  it("validates the name", async () => {
    expect(await createCustomExercise("   ")).toEqual({ error: "Enter an exercise name." });
    expect(await createCustomExercise("x".repeat(101))).toEqual({ error: "Exercise names must be 100 characters or fewer." });
    expect(calls).toHaveLength(0);
  });
});

describe("saveRestPref", () => {
  it("upserts per user and exercise", async () => {
    expect(await saveRestPref(SQUAT, 120)).toEqual({});
    expect(calls[0]).toMatchObject({
      table: "exercise_rest_prefs",
      op: "upsert",
      payload: expect.objectContaining({ user_id: "user-1", exercise_id: SQUAT, rest_seconds: 120 }),
      options: { onConflict: "user_id,exercise_id" },
    });
  });

  it.each([-1, 3601, 1.5, Number.NaN])("rejects %s seconds", async (s) => {
    expect(await saveRestPref(SQUAT, s)).toEqual({ error: "Rest must be a whole number of seconds from 0 to 3600." });
  });

  it("needs an exercise", async () => {
    expect(await saveRestPref("", 90)).toEqual({ error: "Choose an exercise first." });
  });
});

describe("session actions", () => {
  it("deleteLift deletes and returns to the list", async () => {
    expect(await redirectOf(deleteLift(formData({ session_id: SESSION })))).toBe("/lifts");
    expect(calls[0]).toMatchObject({ rpc: "delete_session", payload: { p_session_id: SESSION } });
  });

  it("setLiftStatus only allows planned and skipped", async () => {
    await setLiftStatus(formData({ session_id: SESSION, status: "completed" }));
    expect(calls).toHaveLength(0);
    await setLiftStatus(formData({ session_id: SESSION, status: "skipped" }));
    expect(calls[0]).toMatchObject({ rpc: "set_session_status", payload: { p_session_id: SESSION, p_status: "skipped" } });
  });

  it("throws database errors", async () => {
    useDb(() => ({ error: { message: "Session not found" } }));
    await expect(deleteLift(formData({ session_id: SESSION }))).rejects.toThrow("Lift not deleted: Session not found");
  });
});

describe("routines", () => {
  const routinePayload = (exercises: object[]) =>
    formData({ payload: JSON.stringify({ routineId: null, name: "Leg day", exercises }) });

  it("saveRoutine saves and redirects", async () => {
    const url = await redirectOf(saveRoutine({}, routinePayload([{ exerciseId: SQUAT, targetSets: "5", targetReps: "5" }])));
    expect(url).toBe("/lifts/routines");
    expect(calls[0]).toMatchObject({
      rpc: "save_routine",
      payload: { p_routine_id: null, p_name: "Leg day", p_exercises: [{ exercise_id: SQUAT, target_sets: 5, target_reps: 5 }] },
    });
  });

  it("saveRoutine shows duplicate-name errors from the database", async () => {
    useDb(() => ({ error: { message: 'You already have a routine named "Leg day"' } }));
    expect(await saveRoutine({}, routinePayload([{ exerciseId: SQUAT, targetSets: "", targetReps: "" }]))).toEqual({
      error: 'Routine not saved: You already have a routine named "Leg day"',
    });
  });

  it("deleteRoutine deletes by id", async () => {
    expect(await redirectOf(deleteRoutine(formData({ routine_id: SESSION })))).toBe("/lifts/routines");
    expect(calls[0]).toMatchObject({ table: "routines", op: "delete" });
    expect(filterValue(calls[0], "eq", "id")).toBe(SESSION);
  });
});
