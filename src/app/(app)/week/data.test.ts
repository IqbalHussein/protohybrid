import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { loadBusy, loadRules, loadSessions, splitBusyBlock, toConflictSession } from "./data";

const block = (start: string, end: string) => ({ id: "b", title: "Shift", start_time: start, end_time: end });

describe("splitBusyBlock", () => {
  it("keeps a same-day block in local minutes", () => {
    expect(splitBusyBlock(block("2026-11-03T14:00:00Z", "2026-11-03T15:30:00Z"), "America/New_York")).toEqual([
      { id: "b", title: "Shift", date: "2026-11-03", startMin: 540, endMin: 630 },
    ]);
  });

  it("splits an overnight block at local midnight", () => {
    expect(splitBusyBlock(block("2026-11-04T03:00:00Z", "2026-11-04T11:00:00Z"), "America/New_York")).toEqual([
      { id: "b", title: "Shift", date: "2026-11-03", startMin: 1320, endMin: 1440 },
      { id: "b", title: "Shift", date: "2026-11-04", startMin: 0, endMin: 360 },
    ]);
  });

  it("drops an empty piece when a block ends exactly at midnight", () => {
    expect(splitBusyBlock(block("2026-11-03T22:00:00Z", "2026-11-04T00:00:00Z"), "UTC")).toEqual([
      { id: "b", title: "Shift", date: "2026-11-03", startMin: 1320, endMin: 1440 },
    ]);
  });

  it("covers every day of a multi-day block", () => {
    const pieces = splitBusyBlock(block("2026-11-02T12:00:00Z", "2026-11-05T12:00:00Z"), "UTC");
    expect(pieces.map((p) => [p.date, p.startMin, p.endMin])).toEqual([
      ["2026-11-02", 720, 1440],
      ["2026-11-03", 0, 1440],
      ["2026-11-04", 0, 1440],
      ["2026-11-05", 0, 720],
    ]);
  });
});

describe("loadSessions", () => {
  const row = (extra: Record<string, unknown>) => ({
    id: "s",
    type: "run",
    status: "planned",
    planned_date: "2026-11-03",
    planned_start_time: "07:30:00",
    planned_duration_min: null,
    created_at: "2026-11-01T00:00:00Z",
    run_details: null,
    lift_details: null,
    routines: null,
    ...extra,
  });

  it("maps rows, trimming times and converting numeric strings", async () => {
    const { client } = fakeSupabase(() => ({
      data: [
        row({
          run_details: {
            run_type: "tempo",
            target_distance_km: "10.0",
            target_duration_sec: 3000,
            target_pace_sec_per_km: 300,
            actual_distance_km: null,
            actual_duration_sec: null,
            actual_pace_sec_per_km: null,
            actual_avg_hr: null,
            actual_elevation_m: null,
            notes: null,
          },
        }),
      ],
    }));
    const { sessions, error } = await loadSessions(client, "2026-11-02", "2026-11-08");
    expect(error).toBeNull();
    expect(sessions[0]).toMatchObject({ startTime: "07:30", durationMin: 50, run: { targetDistanceKm: 10, runType: "tempo" } });
  });

  it("uses actual duration for completed runs, rounding up", async () => {
    const { client } = fakeSupabase(() => ({
      data: [
        row({
          status: "completed",
          planned_duration_min: 45,
          run_details: { run_type: "easy", actual_duration_sec: 3061, target_duration_sec: null },
        }),
      ],
    }));
    expect((await loadSessions(client, "a", "b")).sessions[0].durationMin).toBe(52);
  });

  it("counts lift sets and keeps the routine name", async () => {
    const { client } = fakeSupabase(() => ({
      data: [
        row({
          type: "lift",
          planned_start_time: null,
          planned_duration_min: 60,
          lift_details: { focus: "legs", notes: null, lift_sets: [{ id: "1" }, { id: "2" }] },
          routines: { name: "Leg day" },
        }),
      ],
    }));
    const s = (await loadSessions(client, "a", "b")).sessions[0];
    expect(s).toMatchObject({ startTime: null, durationMin: 60, lift: { focus: "legs", setCount: 2, routineName: "Leg day" } });
    expect(toConflictSession(s)).toEqual({
      id: "s",
      type: "lift",
      status: "planned",
      date: "2026-11-03",
      startMin: null,
      durationMin: 60,
      runType: null,
      liftFocus: "legs",
    });
  });

  it("returns the error instead of throwing", async () => {
    const { client } = fakeSupabase(() => ({ error: { message: "timeout" } }));
    expect(await loadSessions(client, "a", "b")).toEqual({ error: "timeout", sessions: [] });
  });
});

describe("loadBusy", () => {
  it("queries the local week as a UTC range and splits blocks", async () => {
    const { client, calls } = fakeSupabase(() => ({
      data: [{ ...block("2026-11-04T03:00:00Z", "2026-11-04T11:00:00Z"), source: "manual" }],
    }));
    const { pieces } = await loadBusy(client, "2026-11-02", "America/New_York");
    expect(calls[0].filters).toEqual(
      expect.arrayContaining([
        ["lt", "start_time", "2026-11-09T05:00:00.000Z"],
        ["gt", "end_time", "2026-11-02T05:00:00.000Z"],
      ]),
    );
    expect(pieces).toHaveLength(2);
    expect(pieces.every((p) => p.source === "manual")).toBe(true);
  });
});

describe("loadRules", () => {
  it("seeds defaults on first use, then reads enabled rules", async () => {
    const { client, calls } = fakeSupabase((c) =>
      c.table === "user_settings" ? { data: { conflict_rules_seeded: false } } : c.table === "conflict_rules" ? { data: [{ id: "r" }] } : undefined,
    );
    const { rules, error } = await loadRules(client);
    expect(error).toBeNull();
    expect(rules).toEqual([{ id: "r" }]);
    expect(calls.map((c) => c.rpc ?? c.table)).toEqual(["user_settings", "seed_default_conflict_rules", "conflict_rules"]);
    expect(calls[2].filters).toContainEqual(["eq", "enabled", true]);
  });

  it("skips seeding once seeded", async () => {
    const { client, calls } = fakeSupabase((c) => (c.table === "user_settings" ? { data: { conflict_rules_seeded: true } } : { data: [] }));
    await loadRules(client);
    expect(calls.some((c) => c.rpc)).toBe(false);
  });

  it("surfaces a seeding error", async () => {
    const { client } = fakeSupabase((c) => (c.rpc ? { error: { message: "denied" } } : { data: null }));
    expect((await loadRules(client)).error).toBe("denied");
  });
});
