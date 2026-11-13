import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, formData, type Call, type Responder } from "@/test/fake-supabase";

const h = vi.hoisted(() => ({ client: null as unknown, revalidated: [] as string[] }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ supabase: h.client, user: { id: "user-1" } }) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));

import { completeRun, deleteRun, logRun, skipRun } from "./actions";

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

const runForm = (extra: Record<string, string> = {}) =>
  formData({ date: "2026-11-03", run_type: "easy", distance_km: "5", duration: "25:00", avg_hr: "", elevation_m: "", notes: "", ...extra });

describe("logRun", () => {
  it("logs a run with optional fields", async () => {
    const res = await logRun({}, runForm({ avg_hr: "150", elevation_m: "40", notes: "nice" }));
    expect(res).toEqual({ ok: true, message: "Run logged." });
    expect(calls[0]).toMatchObject({
      rpc: "log_run",
      payload: {
        p_date: "2026-11-03",
        p_run_type: "easy",
        p_distance_km: 5,
        p_duration_sec: 1500,
        p_avg_hr: 150,
        p_elevation_gain_m: 40,
        p_notes: "nice",
      },
    });
    expect(h.revalidated).toEqual(expect.arrayContaining(["/runs", "/week"]));
  });

  it("sends null for blank HR and elevation", async () => {
    await logRun({}, runForm());
    expect(calls[0].payload).toMatchObject({ p_avg_hr: null, p_elevation_gain_m: null });
  });

  it.each([
    [{ date: "" }, "Pick a date."],
    [{ run_type: "jog" }, "Pick a run type."],
    [{ distance_km: "0" }, "Distance must be greater than 0."],
    [{ distance_km: "" }, "Distance must be greater than 0."],
    [{ duration: "25" }, "Enter duration as mm:ss or h:mm:ss."],
    [{ avg_hr: "19" }, "Average HR must be a whole number from 20 to 250."],
    [{ avg_hr: "150.5" }, "Average HR must be a whole number from 20 to 250."],
    [{ elevation_m: "-1" }, "Elevation gain can't be negative."],
  ])("rejects %j", async (extra, error) => {
    expect(await logRun({}, runForm(extra))).toEqual({ error });
    expect(calls).toHaveLength(0);
  });

  it("surfaces database validation", async () => {
    useDb(() => ({ error: { message: "Distance must be between 0 and 1000 km" } }));
    expect(await logRun({}, runForm({ distance_km: "5000" }))).toEqual({
      error: "Run not saved: Distance must be between 0 and 1000 km",
    });
    expect(h.revalidated).toEqual([]);
  });
});

describe("completeRun", () => {
  const form = (extra: Record<string, string> = {}) =>
    formData({ session_id: ID, distance_km: "10.2", duration: "51:40", avg_hr: "165", elevation_m: "", notes: "windy", ...extra });

  it("records actuals on the session", async () => {
    expect(await completeRun({}, form())).toEqual({ ok: true, message: "Run completed." });
    expect(calls[0]).toMatchObject({
      rpc: "complete_run",
      payload: { p_session_id: ID, p_distance_km: 10.2, p_duration_sec: 3100, p_avg_hr: 165, p_elevation_m: null, p_notes: "windy" },
    });
  });

  it("rejects a missing or malformed session id", async () => {
    expect(await completeRun({}, form({ session_id: "" }))).toEqual({ error: "Missing run." });
    expect(await completeRun({}, form({ session_id: "abc" }))).toEqual({ error: "Missing run." });
    expect(calls).toHaveLength(0);
  });

  it("validates actuals like logRun", async () => {
    expect(await completeRun({}, form({ duration: "" }))).toEqual({ error: "Enter duration as mm:ss or h:mm:ss." });
    expect(await completeRun({}, form({ avg_hr: "300" }))).toEqual({ error: "Average HR must be a whole number from 20 to 250." });
  });
});

describe("deleteRun and skipRun", () => {
  it("call the session RPCs", async () => {
    await deleteRun(formData({ session_id: ID }));
    await skipRun(formData({ session_id: ID }));
    expect(calls.map((c) => [c.rpc, c.payload])).toEqual([
      ["delete_session", { p_session_id: ID }],
      ["set_session_status", { p_session_id: ID, p_status: "skipped" }],
    ]);
  });

  it("ignore malformed ids", async () => {
    await deleteRun(formData({ session_id: "nope" }));
    await skipRun(formData({}));
    expect(calls).toHaveLength(0);
  });

  it("throw database errors so the error boundary shows them", async () => {
    useDb(() => ({ error: { message: "Session not found" } }));
    await expect(deleteRun(formData({ session_id: ID }))).rejects.toThrow("Run not deleted: Session not found");
    await expect(skipRun(formData({ session_id: ID }))).rejects.toThrow("Run not skipped: Session not found");
  });
});
