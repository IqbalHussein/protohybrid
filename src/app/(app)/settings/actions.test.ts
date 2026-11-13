import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, filterValue, formData, type Call, type Responder } from "@/test/fake-supabase";

const h = vi.hoisted(() => ({ client: null as unknown, revalidated: [] as string[], tz: "America/New_York" as string | undefined }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ supabase: h.client, user: { id: "user-1" } }) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "tz" && h.tz ? { value: h.tz } : undefined) }),
}));

import { saveWeightUnit } from "./actions";
import { addBusyBlock, deleteBusyBlock } from "./busy-blocks-actions";
import { addRule, deleteRule, saveRule, toggleRule } from "./conflict-rules-actions";

const ID = "3f2a1b4c-0000-4000-8000-000000000001";
let calls: Call[];

function useDb(respond?: Responder) {
  const fake = fakeSupabase(respond);
  h.client = fake.client;
  calls = fake.calls;
}

beforeEach(() => {
  h.revalidated = [];
  h.tz = "America/New_York";
  useDb();
});

describe("saveWeightUnit", () => {
  it("updates the setting after making sure the row exists", async () => {
    useDb((c) => (c.op === "select" ? { data: { user_id: "user-1", weight_unit: "lb" } } : undefined));
    expect(await saveWeightUnit({}, formData({ weight_unit: "kg" }))).toEqual({ ok: true, message: "Weights now show in kg." });
    const update = calls.find((c) => c.op === "update")!;
    expect(update.payload).toEqual({ weight_unit: "kg" });
    expect(filterValue(update, "eq", "user_id")).toBe("user-1");
    expect(h.revalidated).toContain("/");
  });

  it("rejects other units", async () => {
    expect(await saveWeightUnit({}, formData({ weight_unit: "stone" }))).toEqual({ error: "Choose lb or kg." });
    expect(calls).toHaveLength(0);
  });
});

describe("addBusyBlock", () => {
  const form = (extra: Record<string, string> = {}) =>
    formData({ title: "Class", date: "2026-11-03", start: "09:00", end: "10:30", ...extra });
  const inserted = () => calls.find((c) => c.op === "insert")!.payload as Record<string, string>;

  it("stores local times as UTC in the user's time zone", async () => {
    expect(await addBusyBlock({}, form())).toEqual({ ok: true, message: "Busy time added." });
    expect(inserted()).toEqual({
      user_id: "user-1",
      title: "Class",
      start_time: "2026-11-03T14:00:00.000Z",
      end_time: "2026-11-03T15:30:00.000Z",
      source: "manual",
    });
  });

  it("treats an end before the start as the next day", async () => {
    await addBusyBlock({}, form({ title: "Night shift", start: "22:00", end: "06:00" }));
    expect(inserted()).toMatchObject({ start_time: "2026-11-04T03:00:00.000Z", end_time: "2026-11-04T11:00:00.000Z" });
  });

  it("handles the DST fall-back night", async () => {
    // 2026-11-01: clocks go 02:00 EDT -> 01:00 EST, so 00:00-03:00 is 4 real hours.
    await addBusyBlock({}, form({ date: "2026-11-01", start: "00:00", end: "03:00" }));
    expect(inserted()).toMatchObject({ start_time: "2026-11-01T04:00:00.000Z", end_time: "2026-11-01T08:00:00.000Z" });
  });

  it("falls back to UTC without a tz cookie", async () => {
    h.tz = undefined;
    await addBusyBlock({}, form());
    expect(inserted()).toMatchObject({ start_time: "2026-11-03T09:00:00.000Z" });
  });

  it.each([
    [{ title: " " }, "Give the busy time a name."],
    [{ title: "x".repeat(201) }, "Keep the name under 200 characters."],
    [{ date: "2026-13-01" }, "Pick a date."],
    [{ start: "" }, "Enter a start and end time."],
    [{ end: "9am" }, "Enter a start and end time."],
    [{ end: "09:00" }, "End time must be different from start time."],
  ])("rejects %j", async (extra, error) => {
    expect(await addBusyBlock({}, form(extra))).toEqual({ error });
    expect(calls).toHaveLength(0);
  });
});

describe("deleteBusyBlock", () => {
  it("only deletes manual blocks", async () => {
    await deleteBusyBlock(formData({ id: ID }));
    expect(calls[0]).toMatchObject({ table: "busy_blocks", op: "delete" });
    expect(filterValue(calls[0], "eq", "id")).toBe(ID);
    expect(filterValue(calls[0], "eq", "source")).toBe("manual");
  });

  it("throws database errors", async () => {
    useDb(() => ({ error: { message: "boom" } }));
    await expect(deleteBusyBlock(formData({ id: ID }))).rejects.toThrow("Busy time not deleted: boom");
  });
});

describe("conflict rule actions", () => {
  const existing = (ruleType: string): Responder => (c) =>
    c.op === "select" ? { data: { rule_type: ruleType } } : c.op === "update" ? { data: [{ id: ID }] } : undefined;
  const updated = () => calls.find((c) => c.op === "update")!.payload as Record<string, unknown>;

  it("saves min_hours_between, dropping filters that don't apply to a side", async () => {
    useDb(existing("min_hours_between"));
    const res = await saveRule(
      {},
      formData({
        id: ID,
        name: " Legs before hard runs ",
        enabled: "on",
        hours: "23.7",
        session_type_a: "lift",
        session_type_b: "run",
        a_run_types: ["tempo"], // ignored: side A is lift-only
        a_lift_focus: [" Legs ", "legs", "lower"],
        b_run_types: ["tempo", "interval", "tempo"],
      }),
    );
    expect(res).toEqual({ ok: true, message: "Rule saved." });
    expect(updated()).toEqual({
      name: "Legs before hard runs",
      enabled: true,
      session_type_a: "lift",
      session_type_b: "run",
      params: { hours: 23.5, a_run_types: [], a_lift_focus: ["legs", "lower"], b_run_types: ["tempo", "interval"], b_lift_focus: [] },
    });
  });

  it("stores a blank name as null and unchecked enabled as false", async () => {
    useDb(existing("busy_block_overlap"));
    await saveRule({}, formData({ id: ID, name: "  " }));
    expect(updated()).toMatchObject({ name: null, enabled: false, params: {} });
  });

  it.each([
    ["min_hours_between", { hours: "0", session_type_a: "", session_type_b: "" }, "Hours must be between 1 and 168."],
    ["min_hours_between", { hours: "200", session_type_a: "", session_type_b: "" }, "Hours must be between 1 and 168."],
    ["min_hours_between", { hours: "24", session_type_a: "swim", session_type_b: "" }, "Choose run, lift or any session."],
    ["min_hours_between", { hours: "24", session_type_a: "", session_type_b: "", a_run_types: ["jog"] }, "Unknown run type."],
    ["min_hours_between", { hours: "24", session_type_a: "", session_type_b: "", b_lift_focus: [""] }, "Lift focuses must be short names."],
    ["no_back_to_back_hard", {}, "Choose at least one hard run type or lift focus."],
    ["no_back_to_back_hard", { hard_run_types: ["sprint"] }, "Unknown run type."],
    ["max_days_without_rest", { max_days: "0" }, "Training days in a row must be a whole number from 1 to 30."],
    ["max_days_without_rest", { max_days: "6.5" }, "Training days in a row must be a whole number from 1 to 30."],
  ])("rejects bad %s params %#", async (type, extra, error) => {
    useDb(existing(type));
    expect(await saveRule({}, formData({ id: ID, name: "", ...(extra as Record<string, string>) }))).toEqual({ error });
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("saveRule rejects long names, unknown ids and rules it can't see", async () => {
    expect(await saveRule({}, formData({ id: ID, name: "x".repeat(81) }))).toEqual({ error: "Name must be 80 characters or fewer." });
    expect(await saveRule({}, formData({ id: "nope", name: "" }))).toEqual({ error: "Unknown rule." });
    useDb(() => ({ data: null }));
    expect(await saveRule({}, formData({ id: ID, name: "" }))).toEqual({ error: "Rule not found." });
  });

  it("addRule inserts sensible defaults for each type", async () => {
    await addRule({}, formData({ rule_type: "max_days_without_rest" }));
    await addRule({}, formData({ rule_type: "min_hours_between" }));
    const [rest, gap] = calls.map((c) => c.payload as Record<string, unknown>);
    expect(rest).toMatchObject({ user_id: "user-1", rule_type: "max_days_without_rest", enabled: true, params: { max_days: 6 } });
    expect(gap).toMatchObject({ session_type_a: "lift", session_type_b: "run", params: expect.objectContaining({ hours: 24 }) });
    expect(typeof rest.name).toBe("string");
    expect(await addRule({}, formData({ rule_type: "made_up" }))).toEqual({ error: "Choose a rule type." });
  });

  it("toggleRule and deleteRule report rules that don't exist (or belong to someone else)", async () => {
    useDb(() => ({ data: [] }));
    expect(await toggleRule({}, formData({ id: ID, enabled: "true" }))).toEqual({ error: "Rule not found." });
    expect(await deleteRule({}, formData({ id: ID }))).toEqual({ error: "Rule not found." });
    useDb(() => ({ data: [{ id: ID }] }));
    expect(await toggleRule({}, formData({ id: ID, enabled: "false" }))).toEqual({ ok: true, message: "Rule turned off." });
    expect(calls[0].payload).toEqual({ enabled: false });
    expect(await deleteRule({}, formData({ id: ID }))).toEqual({ ok: true, message: "Rule deleted." });
  });
});
