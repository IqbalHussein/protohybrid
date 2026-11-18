import { describe, expect, it } from "vitest";
import { combinations, dayCandidates, scoreDays } from "./days";
import { budgetsOf } from "./model";
import { profile } from "./testkit";

const budgets = budgetsOf(profile());

describe("dayCandidates", () => {
  it("enumerates C(n, k) combinations", () => {
    expect(combinations([1, 2, 3, 4, 5, 6, 7], 3)).toHaveLength(35);
    expect(combinations([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });

  it("spreads days evenly: 3 days land two days apart", () => {
    const best = dayCandidates(budgets, 3, [], false)[0];
    const gaps = best.days.map((d, i) => (best.days[(i + 1) % 3] - d + 7) % 7);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(3);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2);
  });

  it("avoids preferred rest days when possible and reports them when not", () => {
    const ok = dayCandidates(budgets, 4, [1, 2, 3], false)[0];
    expect(ok.restUsed).toEqual([]);
    const forced = dayCandidates(budgets, 6, [1, 2, 3], false)[0];
    expect(forced.restUsed).toHaveLength(2);
  });

  it("never uses days with no time", () => {
    const b = budgetsOf(profile({ minutesByWeekday: { 2: 0, 4: 0 } }));
    for (const c of dayCandidates(b, 5, [], false)) expect(c.days).not.toContain(2);
    expect(dayCandidates(b, 7, [], false)[0].days).toHaveLength(5);
  });

  it("returns at most twelve candidates in a deterministic order", () => {
    const a = dayCandidates(budgets, 3, [], true);
    expect(a).toHaveLength(12);
    expect(dayCandidates(budgets, 3, [], true)).toEqual(a);
    expect(a.map((c) => c.score)).toEqual([...a.map((c) => c.score)].sort((x, y) => x - y));
  });

  it("favours a weekend day when a long run is wanted and prefers days with more time", () => {
    expect(scoreDays([1, 3, 6], budgets, [], true)).toBeLessThan(scoreDays([1, 3, 5], budgets, [], true));
    const b = budgetsOf(profile({ minutesByWeekday: { 6: 120, 7: 120 } }));
    expect(scoreDays([1, 3, 6], b, [], false)).toBeLessThan(scoreDays([1, 3, 5], b, [], false));
  });

  it("returns nothing when no day has time", () => {
    const b = budgetsOf(profile({ minutesPerDay: 0 }));
    expect(dayCandidates(b, 3, [], false)).toEqual([]);
  });
});
