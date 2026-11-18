import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedBlock } from "@/lib/planner";
import { fakeSupabase, filterValue, formData, type Call, type Responder } from "@/test/fake-supabase";

const h = vi.hoisted(() => ({
  client: null as unknown,
  revalidated: [] as string[],
  generate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ supabase: h.client, user: { id: "user-1" } }) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new (class extends Error {
      url = url;
      constructor() {
        super(`NEXT_REDIRECT ${url}`);
      }
    })();
  },
}));
vi.mock("@/lib/settings", () => ({ getTimeZone: async () => "UTC" }));
// Wednesday 2026-11-18.
vi.mock("@/lib/time", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/time")>()), todayIn: () => "2026-11-18" }));
// Real validation and presets; the generator is a stub.
vi.mock("@/lib/planner", async () => ({
  ...(await import("@/lib/planner/profile")),
  ...(await import("@/lib/planner/presets")),
  generatePlan: (...args: unknown[]) => h.generate(...args),
}));

import { acceptPlan, saveProfile, swapSessions } from "./actions";

const A = "3f2a1b4c-0000-4000-8000-000000000001";
const B = "3f2a1b4c-0000-4000-8000-000000000002";
let calls: Call[];

function useDb(respond?: Responder) {
  const fake = fakeSupabase(respond);
  h.client = fake.client;
  calls = fake.calls;
}

async function redirectOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("NEXT_REDIRECT ")) return e.message.slice("NEXT_REDIRECT ".length);
    throw e;
  }
}

const payload = {
  preset: "hybrid",
  weights: { strength: 35, hypertrophy: 25, endurance: 40 },
  daysPerWeek: 4,
  minutesPerDay: 60,
  restDays: [7],
  goal: { type: "none" },
  experience: "intermediate",
};
const save = (p: unknown = payload) => formData({ payload: JSON.stringify(p) });

const profileRow = {
  user_id: "user-1",
  preset: "hybrid",
  w_strength: 35,
  w_hypertrophy: 25,
  w_endurance: 40,
  days_per_week: 4,
  minutes_per_day: 60,
  minutes_by_weekday: {},
  rest_days: [7],
  goal_type: "none",
  race_distance_km: null,
  race_date: null,
  experience: "intermediate",
};

function fixtureBlock(): GeneratedBlock {
  const mk = (key: string, date: string, weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7) => ({
    key,
    week: 1,
    date,
    weekday,
    slot: null,
    type: "run" as const,
    runType: "easy" as const,
    liftFocus: null,
    heavyLower: false,
    intensity: "easy" as const,
    durationMin: 40,
    prescription: { kind: "run" as const, warmupMin: 0, hardMin: 0, cooldownMin: 0, reps: null, repMin: null, recoveryMin: null, description: "Easy" },
    rationale: "r",
  });
  return {
    generatorVersion: "v-test",
    startDate: "2026-11-16",
    relaxations: [{ constraint: "timeBudget", title: "t", detail: "d" }],
    summary: "sum",
    weeks: [
      {
        index: 1,
        kind: "build",
        startDate: "2026-11-16",
        totals: { runMin: 80, hardRunMin: 0, liftMin: 0, liftSets: 0 },
        sessions: [mk("w1-1", "2026-11-16", 1), mk("w1-4", "2026-11-19", 4)],
      },
    ],
  };
}

beforeEach(() => {
  h.revalidated = [];
  h.generate.mockReset();
  h.generate.mockImplementation((_p, opts: { startDate: string }) => ({ ...fixtureBlock(), startDate: opts.startDate }));
  useDb();
});

describe("saveProfile", () => {
  it("upserts the validated profile and redirects to the preview", async () => {
    expect(await redirectOf(saveProfile({}, save()))).toBe("/plan?preview=1");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "training_profiles", op: "upsert", options: { onConflict: "user_id" } });
    expect(calls[0].payload).toMatchObject({
      user_id: "user-1",
      preset: "hybrid",
      w_strength: 35,
      days_per_week: 4,
      minutes_per_day: 60,
      rest_days: [7],
      goal_type: "none",
    });
    expect(h.revalidated).toContain("/plan");
  });

  it("stores a race goal", async () => {
    const goal = { type: "race", distanceKm: "21.1", date: "2027-03-14" };
    await redirectOf(saveProfile({}, save({ ...payload, goal })));
    expect(calls[0].payload).toMatchObject({ goal_type: "race", race_distance_km: 21.1, race_date: "2027-03-14" });
  });

  it.each([
    [{ ...payload, weights: { strength: 50, hypertrophy: 25, endurance: 40 } }, "Strength, hypertrophy and endurance must add up to 100."],
    [{ ...payload, daysPerWeek: 1 }, "Days per week must be from 2 to 7."],
    [{ ...payload, minutesPerDay: 5 }, "Minutes per day must be from 10 to 300."],
    [{ ...payload, goal: { type: "race", distanceKm: 10, date: "" } }, "Pick a race date."],
  ])("returns the validation message %#", async (p, error) => {
    expect(await saveProfile({}, save(p))).toEqual({ error });
    expect(calls).toHaveLength(0);
  });

  it("rejects unreadable payloads", async () => {
    expect((await saveProfile({}, formData({ payload: "{nope" }))).error).toMatch(/couldn't be read/);
    expect((await saveProfile({}, formData({}))).error).toMatch(/couldn't be read/);
    expect(calls).toHaveLength(0);
  });

  it("reports database errors without redirecting", async () => {
    useDb(() => ({ error: { message: "permission denied" } }));
    expect(await saveProfile({}, save())).toEqual({ error: "Profile not saved: permission denied" });
    expect(h.revalidated).toEqual([]);
  });
});

describe("acceptPlan", () => {
  const withProfile: Responder = (c) => (c.table === "training_profiles" ? { data: profileRow } : undefined);

  it("starts next Monday with every session and RPC argument", async () => {
    useDb(withProfile);
    expect(await redirectOf(acceptPlan({}, formData({ start: "next", allow_same_day: "on" })))).toBe("/plan");
    expect(h.generate).toHaveBeenCalledWith(expect.objectContaining({ daysPerWeek: 4, weights: expect.any(Object) }), { startDate: "2026-11-23" });
    const rpc = calls.find((c) => c.rpc === "accept_training_block")!;
    expect(filterValue(calls[0], "eq", "user_id")).toBe("user-1");
    expect(rpc.payload).toMatchObject({
      p_start_date: "2026-11-23",
      p_weeks: 1,
      p_today: "2026-11-18",
      p_summary: "sum",
      p_generator_version: "v-test",
      p_allow_same_day_hard: true,
      p_profile: { preset: "hybrid", daysPerWeek: 4, goal: { type: "none" } },
      p_relaxations: [{ constraint: "timeBudget", title: "t", detail: "d" }],
    });
    expect((rpc.payload as { p_sessions: unknown[] }).p_sessions).toHaveLength(2);
    expect(h.revalidated).toEqual(expect.arrayContaining(["/plan", "/week", "/runs", "/lifts"]));
  });

  it("leaves allow_same_day off when the box is unchecked", async () => {
    useDb(withProfile);
    await redirectOf(acceptPlan({}, formData({ start: "next" })));
    expect(calls.find((c) => c.rpc)!.payload).toMatchObject({ p_allow_same_day_hard: false });
  });

  it("starting this week drops sessions before today", async () => {
    useDb(withProfile);
    await redirectOf(acceptPlan({}, formData({ start: "this" })));
    expect(h.generate).toHaveBeenCalledWith(expect.anything(), { startDate: "2026-11-16" });
    const sessions = (calls.find((c) => c.rpc)!.payload as { p_sessions: { date: string }[] }).p_sessions;
    expect(sessions.map((s) => s.date)).toEqual(["2026-11-19"]);
  });

  it("errors when there is no profile", async () => {
    expect(await acceptPlan({}, formData({ start: "next" }))).toEqual({ error: "Set up your profile first." });
    expect(h.generate).not.toHaveBeenCalled();
  });

  it("errors when nothing is left to plan", async () => {
    useDb(withProfile);
    h.generate.mockImplementation(() => ({ ...fixtureBlock(), weeks: [{ ...fixtureBlock().weeks[0], sessions: [] }] }));
    expect((await acceptPlan({}, formData({ start: "next" }))).error).toMatch(/Nothing is left/);
    expect(calls.some((c) => c.rpc)).toBe(false);
  });

  it("rejects an unknown start choice", async () => {
    useDb(withProfile);
    expect(await acceptPlan({}, formData({ start: "later" }))).toEqual({ error: "Choose when the plan starts." });
  });

  it("reports RPC errors without redirecting", async () => {
    useDb((c) => (c.rpc ? { error: { message: "boom" } } : withProfile(c)));
    expect(await acceptPlan({}, formData({ start: "next" }))).toEqual({ error: "Plan not saved: boom" });
    expect(h.revalidated).toEqual([]);
  });
});

describe("swapSessions", () => {
  it("swaps two sessions", async () => {
    expect(await swapSessions({}, formData({ session_a: A, session_b: B }))).toEqual({ ok: true, message: "Sessions swapped." });
    expect(calls[0]).toMatchObject({ rpc: "swap_sessions", payload: { p_session_a: A, p_session_b: B } });
    expect(h.revalidated).toEqual(expect.arrayContaining(["/plan", "/week"]));
  });

  it("validates ids and distinctness", async () => {
    expect((await swapSessions({}, formData({ session_a: A, session_b: "x" }))).error).toBeTruthy();
    expect((await swapSessions({}, formData({ session_a: A, session_b: A }))).error).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("reports database errors", async () => {
    useDb(() => ({ error: { message: "Session not found" } }));
    expect(await swapSessions({}, formData({ session_a: A, session_b: B }))).toEqual({
      error: "Sessions not swapped: Session not found",
    });
  });
});
