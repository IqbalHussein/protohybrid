import { describe, expect, it } from "vitest";
import { checkWeek } from "./layout";
import { budgetsOf, type LiftSpec, type RunSpec } from "./model";
import { fitDay, placeSessions } from "./schedule";
import { profile } from "./testkit";

const lift = (id: string, over: Partial<LiftSpec> = {}): LiftSpec => ({
  type: "lift",
  id,
  focus: "upper",
  variant: "volume",
  heavyLower: false,
  durationMin: 50,
  minDurationMin: 30,
  ...over,
});
const run = (id: string, runType: RunSpec["runType"], dur: number, over: Partial<RunSpec> = {}): RunSpec => ({
  type: "run",
  id,
  runType,
  durationMin: dur,
  minDurationMin: runType === "easy" ? 20 : dur,
  hardMin: runType === "tempo" ? dur - 15 : 0,
  warmupMin: 10,
  alternates: false,
  ...over,
});
const budgets = budgetsOf(profile());

describe("fitDay", () => {
  it("leaves sessions alone when they fit", () => {
    expect(fitDay(60, [run("a", "easy", 25), lift("b", { durationMin: 35 })])).toEqual([25, 35]);
  });
  it("shrinks flexible sessions proportionally, never below their minimum", () => {
    const out = fitDay(60, [run("a", "easy", 40), lift("b", { durationMin: 50 })]);
    expect(out[0] + out[1]).toBeLessThanOrEqual(60);
    expect(out[0]).toBeGreaterThanOrEqual(20);
    expect(out[1]).toBeGreaterThanOrEqual(30);
    expect(out[0] + out[1]).toBeGreaterThanOrEqual(55); // little is wasted
  });
  it("never shrinks fixed runs", () => {
    const out = fitDay(60, [run("t", "tempo", 30), lift("b", { durationMin: 50 })]);
    expect(out[0]).toBe(30);
    expect(out[1]).toBe(30);
  });
});

describe("placeSessions", () => {
  const input = {
    lifts: [lift("lift-0", { focus: "lower", heavyLower: true, variant: "heavy" }), lift("lift-1")],
    runs: [run("run-long", "long", 50), run("run-hard-0", "tempo", 30)],
    days: [1, 3, 5, 6] as (1 | 2 | 3 | 4 | 5 | 6 | 7)[],
    budgets,
    restDays: [],
    wantsLong: true,
  };

  it("places everything with no hard violations and keeps lifts in split order", () => {
    const p = placeSessions(input);
    expect(p).not.toBeNull();
    expect(p!.placed).toHaveLength(4);
    const lifts = p!.placed.filter((x) => x.spec.type === "lift").sort((a, b) => a.weekday - b.weekday);
    expect(lifts.map((x) => x.spec.id)).toEqual(["lift-0", "lift-1"]);
    expect(checkWeek(p!.layout).filter((v) => ["timeBudget", "noHeavyLowerBeforeHardRun", "maxConsecutiveHardDays"].includes(v.constraint))).toEqual([]);
  });

  it("is deterministic", () => {
    expect(placeSessions(input)).toEqual(placeSessions(input));
  });

  it("stacks run AM and lift PM when there are more sessions than days", () => {
    const p = placeSessions({ ...input, days: [1, 4, 6] })!;
    const stacked = p.placed.filter((x) => x.slot !== null);
    expect(stacked).toHaveLength(2);
    expect(stacked.find((x) => x.spec.type === "run")!.slot).toBe("am");
    expect(stacked.find((x) => x.spec.type === "lift")!.slot).toBe("pm");
    const day = stacked[0].weekday;
    expect(stacked.reduce((n, x) => n + x.durationMin, 0)).toBeLessThanOrEqual(budgets[day]);
  });

  it("returns null when the sessions cannot fit the days", () => {
    const tooMany = { ...input, days: [1, 3] as (1 | 3)[], runs: [run("a", "long", 60), run("b", "tempo", 45)] };
    expect(placeSessions(tooMany)).toBeNull();
  });

  it("puts the hard run on a day clear of heavy legs", () => {
    const p = placeSessions({ ...input, days: [1, 2, 4, 6] })!;
    expect(checkWeek(p.layout).some((v) => v.constraint === "noHeavyLowerBeforeHardRun")).toBe(false);
  });
});
