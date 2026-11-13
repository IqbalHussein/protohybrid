import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, formData, type Call, type Responder } from "@/test/fake-supabase";

const h = vi.hoisted(() => ({ client: null as unknown, revalidated: [] as string[] }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ supabase: h.client, user: { id: "user-1" } }) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));

import { deleteSession, moveSession, moveSessionForm, planSession, setStatus } from "./actions";

const ID = "3f2a1b4c-0000-4000-8000-000000000001";
let calls: Call[];

function useDb(respond?: Responder) {
  const fake = fakeSupabase(respond);
  h.client = fake.client;
  calls = fake.calls;
}

beforeEach(() => {
  h.revalidated = [];
  useDb();
});

const run = (extra: Record<string, string> = {}) =>
  formData({ kind: "run", date: "2026-11-05", start_time: "", duration_min: "", run_type: "tempo", ...extra });
const lift = (extra: Record<string, string> = {}) =>
  formData({ kind: "lift", date: "2026-11-05", start_time: "", duration_min: "", focus: "legs", ...extra });

describe("planSession", () => {
  it("plans a run with every target converted", async () => {
    const res = await planSession(
      {},
      run({ start_time: "07:30", duration_min: "50", target_distance_km: "10", target_duration: "50:00", target_pace: "5:00" }),
    );
    expect(res).toEqual({ ok: true, message: "Run planned." });
    expect(calls).toHaveLength(1);
    expect(calls[0].rpc).toBe("plan_run");
    expect(calls[0].payload).toEqual({
      p_date: "2026-11-05",
      p_run_type: "tempo",
      p_start_time: "07:30",
      p_duration_min: 50,
      p_target_distance_km: 10,
      p_target_duration_sec: 3000,
      p_target_pace_sec_per_km: 300,
    });
    expect(h.revalidated).toEqual(expect.arrayContaining(["/week", "/runs", "/lifts"]));
  });

  it("sends nulls for blank optional run fields", async () => {
    await planSession({}, run());
    expect(calls[0].payload).toMatchObject({
      p_start_time: null,
      p_duration_min: null,
      p_target_distance_km: null,
      p_target_duration_sec: null,
      p_target_pace_sec_per_km: null,
    });
  });

  it("plans a lift with routine and trimmed notes", async () => {
    const res = await planSession({}, lift({ routine_id: ID, notes: "  heavy  " }));
    expect(res.ok).toBe(true);
    expect(calls[0].rpc).toBe("plan_lift");
    expect(calls[0].payload).toEqual({
      p_date: "2026-11-05",
      p_focus: "legs",
      p_start_time: null,
      p_duration_min: null,
      p_routine_id: ID,
      p_notes: "heavy",
    });
  });

  it.each([
    [run({ date: "2026-02-30" }), "Pick a date."],
    [run({ start_time: "25:00" }), "Start time must be HH:MM."],
    [run({ duration_min: "0" }), "Duration must be a whole number of minutes from 1 to 1440."],
    [run({ duration_min: "1441" }), "Duration must be a whole number of minutes from 1 to 1440."],
    [run({ duration_min: "30.5" }), "Duration must be a whole number of minutes from 1 to 1440."],
    [run({ run_type: "jog" }), "Pick a run type."],
    [run({ target_distance_km: "0" }), "Target distance must be between 0 and 1000 km."],
    [run({ target_distance_km: "abc" }), "Target distance must be between 0 and 1000 km."],
    [run({ target_duration: "50" }), "Target time must be mm:ss or h:mm:ss."],
    [run({ target_pace: "5:75" }), "Target pace must be mm:ss per km."],
    [lift({ focus: "" }), "Pick a focus."],
    [lift({ focus: "x".repeat(51) }), "Pick a focus."],
    [lift({ routine_id: "not-a-uuid" }), "Pick a routine from the list."],
    [lift({ notes: "x".repeat(2001) }), "Notes are too long."],
    [formData({ kind: "swim", date: "2026-11-05" }), "Choose run or lift."],
  ])("rejects bad input %#", async (fd, error) => {
    expect(await planSession({}, fd)).toEqual({ error });
    expect(calls.filter((c) => c.rpc)).toHaveLength(0);
  });

  it("reports database errors without revalidating", async () => {
    useDb(() => ({ error: { message: "Routine not found" } }));
    expect(await planSession({}, lift({ routine_id: ID }))).toEqual({ error: "Lift not planned: Routine not found" });
    expect(h.revalidated).toEqual([]);
  });
});

describe("moveSession", () => {
  it("reschedules, keeping a null time", async () => {
    expect(await moveSession(ID, "2026-11-10", null)).toEqual({ ok: true, message: "Session moved." });
    expect(calls[0]).toMatchObject({
      rpc: "reschedule_session",
      payload: { p_session_id: ID, p_date: "2026-11-10", p_start_time: null },
    });
  });

  it("trims seconds off a time", async () => {
    await moveSession(ID, "2026-11-10", "06:00:00");
    expect(calls[0].payload).toMatchObject({ p_start_time: "06:00" });
  });

  it("validates id, date and time", async () => {
    expect(await moveSession("x", "2026-11-10", null)).toEqual({ error: "Unknown session." });
    expect(await moveSession(ID, "11/10/2026", null)).toEqual({ error: "Pick a date." });
    expect(await moveSession(ID, "2026-11-10", "6pm")).toEqual({ error: "Start time must be HH:MM." });
    expect(calls).toHaveLength(0);
  });

  it("reads the Move dialog form, treating a blank time as none", async () => {
    await moveSessionForm({}, formData({ session_id: ID, date: "2026-11-11", start_time: "" }));
    expect(calls[0].payload).toEqual({ p_session_id: ID, p_date: "2026-11-11", p_start_time: null });
  });

  it("reports database errors", async () => {
    useDb(() => ({ error: { message: "Session not found" } }));
    expect(await moveSession(ID, "2026-11-10", null)).toEqual({ error: "Session not moved: Session not found" });
  });
});

describe("setStatus", () => {
  it("skips and restores", async () => {
    expect(await setStatus({}, formData({ session_id: ID, status: "skipped" }))).toEqual({ ok: true, message: "Session skipped." });
    expect(await setStatus({}, formData({ session_id: ID, status: "planned" }))).toEqual({ ok: true, message: "Session restored." });
    expect(calls.map((c) => c.payload)).toEqual([
      { p_session_id: ID, p_status: "skipped" },
      { p_session_id: ID, p_status: "planned" },
    ]);
  });

  it("does not allow marking completed without actuals", async () => {
    expect(await setStatus({}, formData({ session_id: ID, status: "completed" }))).toEqual({ error: "Unknown status." });
    expect(calls).toHaveLength(0);
  });
});

describe("deleteSession", () => {
  it("deletes by id", async () => {
    expect(await deleteSession({}, formData({ session_id: ID }))).toEqual({ ok: true, message: "Session deleted." });
    expect(calls[0]).toMatchObject({ rpc: "delete_session", payload: { p_session_id: ID } });
  });

  it("rejects a malformed id", async () => {
    expect(await deleteSession({}, formData({ session_id: "1; drop table" }))).toEqual({ error: "Unknown session." });
    expect(calls).toHaveLength(0);
  });
});
