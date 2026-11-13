import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";

const h = vi.hoisted(() => ({ tz: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "tz" && h.tz !== undefined ? { value: h.tz } : undefined) }),
}));

import { ensureDefaultConflictRules, getTimeZone, getUserSettings, getWeightUnit } from "./settings";

const row = { user_id: "u", weight_unit: "kg", conflict_rules_seeded: false };

describe("getUserSettings", () => {
  it("returns an existing row without writing", async () => {
    const { client, calls } = fakeSupabase(() => ({ data: row }));
    expect(await getUserSettings(client, "u")).toEqual(row);
    expect(await getWeightUnit(client, "u")).toBe("kg");
    expect(calls.every((c) => c.op === "select")).toBe(true);
  });

  it("creates the row with defaults when missing, without overwriting a concurrent insert", async () => {
    let reads = 0;
    const { client, calls } = fakeSupabase((c) => (c.op === "select" ? { data: reads++ === 0 ? null : { ...row, weight_unit: "lb" } } : undefined));
    expect((await getUserSettings(client, "u")).weight_unit).toBe("lb");
    const upsert = calls.find((c) => c.op === "upsert")!;
    expect(upsert.payload).toEqual({ user_id: "u" });
    expect(upsert.options).toEqual({ onConflict: "user_id", ignoreDuplicates: true });
  });

  it("throws if the row still can't be read", async () => {
    const { client } = fakeSupabase((c) => (c.op === "select" ? { data: null, error: c.filters.some((f) => f[0] === "single") ? { message: "denied" } : null } : undefined));
    await expect(getUserSettings(client, "u")).rejects.toThrow("Couldn't load settings: denied");
  });
});

describe("ensureDefaultConflictRules", () => {
  it("seeds only when not yet seeded", async () => {
    const fresh = fakeSupabase(() => ({ data: { conflict_rules_seeded: false } }));
    expect(await ensureDefaultConflictRules(fresh.client)).toBeNull();
    expect(fresh.calls.map((c) => c.rpc)).toContain("seed_default_conflict_rules");

    const seeded = fakeSupabase(() => ({ data: { conflict_rules_seeded: true } }));
    await ensureDefaultConflictRules(seeded.client);
    expect(seeded.calls.some((c) => c.rpc)).toBe(false);
  });
});

describe("getTimeZone", () => {
  it("uses a valid cookie and falls back to UTC otherwise", async () => {
    h.tz = "Europe/London";
    expect(await getTimeZone()).toBe("Europe/London");
    h.tz = "Mars/Olympus";
    expect(await getTimeZone()).toBe("UTC");
    h.tz = undefined;
    expect(await getTimeZone()).toBe("UTC");
  });
});
