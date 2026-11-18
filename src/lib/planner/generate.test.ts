import { describe, expect, it } from "vitest";
import { BLOCK_CONSTRAINTS, CONSTRAINTS } from "./constraints";
import { avoidBackToBackHard } from "./constraints/avoidBackToBackHard";
import { maxConsecutiveHardDays } from "./constraints/maxConsecutiveHardDays";
import { noHeavyLowerBeforeHardRun } from "./constraints/noHeavyLowerBeforeHardRun";
import { timeBudget } from "./constraints/timeBudget";
import { generatePlan, GENERATOR_VERSION } from "./generate";
import { weekLayoutOf } from "./layout";
import { dayBudget } from "./model";
import { presetWeights } from "./presets";
import { profile } from "./testkit";
import type { GeneratedBlock, GeneratedWeek, Preset, TrainingProfile } from "./types";

const START = "2026-11-23"; // a Monday
const HARD_IDS = new Set(CONSTRAINTS.filter((c) => c.severity === "hard").map((c) => c.id));
const gen = (p: TrainingProfile, weeks = 4) => generatePlan(p, { startDate: START, weeks });
const ids = (b: GeneratedBlock) => b.relaxations.map((r) => r.constraint);

function assertSafe(p: TrainingProfile, w: GeneratedWeek) {
  const l = weekLayoutOf(p, w);
  expect(timeBudget.check(l)).toEqual([]);
  expect(noHeavyLowerBeforeHardRun.check(l)).toEqual([]);
  expect(maxConsecutiveHardDays.check(l)).toEqual([]);
  for (const d of l.days) {
    const used = w.sessions.filter((s) => s.weekday === d.weekday && s.runType !== "race").reduce((n, s) => n + s.durationMin, 0);
    expect(used).toBeLessThanOrEqual(dayBudget(p, d.weekday));
  }
}

// At 45 min a stack of a 20-min easy run (or 25-min hard run) and a 30-min lift needs more than a day,
// so the planner has to drop a session there. Everything else must schedule without drops.
const GENUINE_DROPS = new Set(["builder-3-45", "lifter-3-45", "hybrid-3-45"]);

describe("scenario matrix", () => {
  const cases = [45, 60, 90].flatMap((minutes) =>
    (["builder", "lifter", "runner", "hybrid"] as Preset[]).flatMap((preset) =>
      [3, 4, 5, 6].map((days) => [preset, days, minutes] as const),
    ),
  );

  it.each(cases)("%s, %i days a week, %i min a day", (preset, days, minutes) => {
    const p = profile({ preset, daysPerWeek: days, minutesPerDay: minutes });
    const b = gen(p);
    const { strength, hypertrophy, endurance } = presetWeights(preset);
    const target = (strength + hypertrophy) / 100;
    const tolerance = minutes >= 60 ? 0.1 : 0.15;
    expect(b.generatorVersion).toBe(GENERATOR_VERSION);
    expect(b.weeks.map((w) => w.kind)).toEqual(["build", "build", "build", "deload"]);

    const hardRelaxations = b.relaxations.filter((r) => HARD_IDS.has(r.constraint));
    if (GENUINE_DROPS.has(`${preset}-${days}-${minutes}`)) {
      expect(hardRelaxations).toHaveLength(1);
      expect(hardRelaxations[0]).toMatchObject({ constraint: "timeBudget" });
      expect(hardRelaxations[0].title).toMatch(/^Dropped/);
    } else {
      expect(hardRelaxations).toEqual([]);
    }

    for (const w of b.weeks) {
      assertSafe(p, w);
      const { runMin, hardRunMin, liftMin } = w.totals;
      const runs = w.sessions.filter((s) => s.type === "run");
      if (runMin > 0) expect(hardRunMin / runMin).toBeLessThanOrEqual(0.3 + 1e-9);
      if (runs.length >= 3 && runMin >= 90) {
        expect(hardRunMin / runMin).toBeGreaterThanOrEqual(0.1);
        expect(hardRunMin / runMin).toBeLessThanOrEqual(0.3);
      }
      expect(runs.some((s) => s.runType === "long")).toBe(endurance >= 30);
      const share = liftMin / (liftMin + runMin);
      // deload weeks cut minutes unevenly (minimum run lengths), so they get 5 points more slack
      expect(Math.abs(share - target)).toBeLessThanOrEqual(tolerance + (w.kind === "deload" ? 0.05 : 0) + 1e-9);
      for (const s of w.sessions) {
        expect(s.rationale.trim().length).toBeGreaterThan(0);
        expect(s.date >= w.startDate).toBe(true);
      }
    }

    // key runs (tempo, interval, long) are spread over the week
    for (const w of b.weeks) {
      const keyDays = new Map<number, string>();
      for (const s of w.sessions) if (s.type === "run" && ["tempo", "interval", "long"].includes(s.runType ?? "")) keyDays.set(s.weekday, s.runType as string);
      const next = (d: number) => (d % 7) + 1;
      for (const [d, t] of keyDays) {
        const n = keyDays.get(next(d));
        if (t !== "long" && n && n !== "long") throw new Error(`week ${w.index}: ${t} on day ${d} and ${n} on day ${next(d)}`);
        if (n && keyDays.has(next(next(d)))) throw new Error(`week ${w.index}: key runs on three consecutive days from ${d}`);
        // long run next to a hard run, with 5 or fewer days
        if (days <= 5 && (t === "long" ? n && n !== "long" : n === "long"))
          throw new Error(`week ${w.index}: long run adjacent to a hard run (${d}/${next(d)})`);
      }
    }

    // quality of the time use: week 1 fills the budget, no build week has a stunted lift
    if (minutes >= 60) {
      for (const w of b.weeks.filter((x) => x.kind === "build")) {
        const used = w.totals.runMin + w.totals.liftMin;
        const share = w.totals.liftMin / used;
        // time is left idle only when filling it would push lifting well past its target
        if (w.index === 1 && share < target + 0.07)
          expect(used).toBeGreaterThanOrEqual(0.85 * days * minutes);
        const lifts = w.sessions.filter((s) => s.type === "lift");
        const longest = Math.max(0, ...lifts.map((l) => l.durationMin));
        for (const l of lifts) {
          // a lift under 40 min (or under 75% of the week's longest lift) must be stacked behind a run
          // that leaves no more room, e.g. a 25 min hard run on a 60 min day
          const day = w.sessions.filter((x) => x.weekday === l.weekday && x !== l);
          const squeezed = day.some((x) => x.type === "run" && x.durationMin + 40 > minutes);
          if (!squeezed) {
            expect(l.durationMin).toBeGreaterThanOrEqual(40);
            expect(l.durationMin).toBeGreaterThanOrEqual(0.75 * longest - 5);
          }
        }
      }
    }

    // block-scope constraints, plus the direct assertions
    for (const c of BLOCK_CONSTRAINTS) expect(c.check(b)).toEqual([]);
    const build = b.weeks.filter((w) => w.kind === "build");
    for (let i = 1; i < build.length; i++) {
      expect(build[i].totals.runMin).toBeLessThanOrEqual(build[i - 1].totals.runMin * 1.1 + 1e-9);
      expect(build[i].totals.liftSets).toBeGreaterThanOrEqual(build[i - 1].totals.liftSets);
    }
    const ref = build[2].totals;
    const deload = b.weeks[3].totals;
    // runs already at their minimum lengths cannot be cut further
    const deloadRuns = b.weeks[3].sessions.filter((x) => x.type === "run");
    if (ref.runMin > 0 && deloadRuns.some((x) => x.durationMin > (x.intensity === "hard" ? 25 : 20))) {
      expect(deload.runMin / ref.runMin).toBeGreaterThanOrEqual(0.5);
      expect(deload.runMin / ref.runMin).toBeLessThanOrEqual(0.7);
    }
    if (ref.liftSets > 0) {
      expect(deload.liftSets / ref.liftSets).toBeGreaterThanOrEqual(0.5);
      expect(deload.liftSets / ref.liftSets).toBeLessThanOrEqual(0.7);
    }
  });

  it("uses the requested number of training days with at most one run and one lift a day", () => {
    for (const days of [3, 4, 5, 6]) {
      const b = gen(profile({ daysPerWeek: days }));
      for (const w of b.weeks) {
        expect(new Set(w.sessions.map((s) => s.weekday)).size).toBeLessThanOrEqual(days);
        for (const wd of [1, 2, 3, 4, 5, 6, 7]) {
          const day = w.sessions.filter((s) => s.weekday === wd);
          expect(day.filter((s) => s.type === "run").length).toBeLessThanOrEqual(1);
          expect(day.filter((s) => s.type === "lift").length).toBeLessThanOrEqual(1);
          if (day.length === 2) expect(day.map((s) => s.slot).sort()).toEqual(["am", "pm"]);
          if (day.length === 1) expect(day[0].slot).toBeNull();
        }
      }
    }
  });

  it("keeps weekdays fixed across weeks and keys unique", () => {
    const b = gen(profile({ daysPerWeek: 5 }), 8);
    const keys = b.weeks.flatMap((w) => w.sessions.map((s) => s.key));
    expect(new Set(keys).size).toBe(keys.length);
    const days0 = b.weeks[0].sessions.map((s) => s.weekday).join();
    for (const w of b.weeks) expect(w.sessions.map((s) => s.weekday).join()).toBe(days0);
    const s = b.weeks[1].sessions[0];
    expect(s.key).toBe(`w2-${s.weekday}-${s.type}`);
    expect(s.date).toBe(new Date(Date.UTC(2026, 10, 23 + 7 + s.weekday - 1)).toISOString().slice(0, 10));
  });

  it("rolls the 4-week cycle for longer blocks without breaking progression", () => {
    const b = gen(profile({ daysPerWeek: 4 }), 8);
    expect(b.weeks.map((w) => w.kind)).toEqual(["build", "build", "build", "deload", "build", "build", "build", "deload"]);
    for (const c of BLOCK_CONSTRAINTS.filter((x) => x.severity === "hard")) expect(c.check(b)).toEqual([]);
    for (const w of b.weeks) assertSafe(profile({ daysPerWeek: 4 }), w);
  });

  it("describes the block in the summary", () => {
    const b = gen(profile({ daysPerWeek: 4 }));
    expect(b.summary).toMatch(/^4-week block: \d sessions a week \(.*\), about \d+ min, .* split, week 4 deload\.$/);
  });
});

describe("edge cases", () => {
  it("handles 2 days a week", () => {
    const p = profile({ daysPerWeek: 2 });
    const b = gen(p);
    expect(b.weeks).toHaveLength(4);
    for (const w of b.weeks) {
      assertSafe(p, w);
      expect(new Set(w.sessions.map((s) => s.weekday)).size).toBeLessThanOrEqual(2);
      expect(w.sessions.length).toBeGreaterThan(0);
    }
  });

  it("handles 7 days a week", () => {
    for (const preset of ["hybrid", "runner", "lifter", "builder"] as Preset[]) {
      const p = profile({ preset, daysPerWeek: 7 });
      const b = gen(p);
      for (const w of b.weeks) assertSafe(p, w);
      expect(b.relaxations.filter((r) => HARD_IDS.has(r.constraint))).toEqual([]);
    }
  });

  it.each([20, 30])("handles %i minute days", (minutes) => {
    const p = profile({ minutesPerDay: minutes, daysPerWeek: 4 });
    const b = gen(p);
    for (const w of b.weeks) {
      expect(timeBudget.check(weekLayoutOf(p, w))).toEqual([]);
      expect(noHeavyLowerBeforeHardRun.check(weekLayoutOf(p, w))).toEqual([]);
      expect(w.sessions.length).toBeGreaterThan(0);
    }
    if (minutes === 20) expect(ids(b)).toContain("minSessionLength");
    else expect(b.relaxations.filter((r) => HARD_IDS.has(r.constraint))).toEqual([]);
  });

  it("returns a plan with relaxations for a marathon on 2 x 45 min", () => {
    const p = profile({
      preset: "runner",
      daysPerWeek: 2,
      minutesPerDay: 45,
      goal: { type: "race", distanceKm: 42.2, date: "2027-01-31" },
    });
    const b = gen(p, 10);
    expect(b.weeks).toHaveLength(10);
    expect(ids(b)).toContain("goalVolume");
    const vol = b.relaxations.find((r) => r.constraint === "goalVolume")!;
    expect(vol.detail).toContain("marathon");
    expect(vol.detail).toContain("2 × 45 min");
    expect(b.weeks[9].kind).toBe("race");
    for (const w of b.weeks) assertSafe(p, w);
  });

  it("includes a long run and a goalConflict note for a Lifter with a race goal", () => {
    const p = profile({ preset: "lifter", goal: { type: "race", distanceKm: 10, date: "2027-03-01" } });
    const b = gen(p);
    expect(ids(b)).toContain("goalConflict");
    for (const w of b.weeks) expect(w.sessions.some((s) => s.runType === "long")).toBe(true);
    for (const w of b.weeks) assertSafe(p, w);
  });

  it("notes a goalConflict for a Runner with a strength goal", () => {
    const b = gen(profile({ preset: "runner", goal: { type: "strength" } }));
    expect(ids(b)).toContain("goalConflict");
    expect(b.weeks[0].sessions.some((s) => s.type === "lift")).toBe(true);
  });

  it("shifts rep schemes toward strength with a strength goal", () => {
    const heavy = (goal: TrainingProfile["goal"]) => {
      const b = gen(profile({ preset: "hybrid", daysPerWeek: 4, goal }));
      const s = b.weeks[0].sessions.find((x) => x.type === "lift" && x.prescription.kind === "lift" && x.prescription.variant === "heavy");
      return s?.prescription.kind === "lift" ? s.prescription.exercises[0].repsLow : null;
    };
    expect(heavy({ type: "strength" })!).toBeLessThanOrEqual(heavy({ type: "none" })!);
  });

  it("uses rest days when all seven are marked, and says so", () => {
    const p = profile({ restDays: [1, 2, 3, 4, 5, 6, 7], daysPerWeek: 4 });
    const b = gen(p);
    expect(ids(b)).toContain("respectRestDays");
    expect(b.weeks[0].sessions.length).toBeGreaterThan(0);
    for (const w of b.weeks) assertSafe(p, w);
  });

  it("avoids preferred rest days when it can", () => {
    const b = gen(profile({ restDays: [1, 3], daysPerWeek: 4 }));
    expect(ids(b)).not.toContain("respectRestDays");
    for (const s of b.weeks[0].sessions) expect([1, 3]).not.toContain(s.weekday);
  });

  it("respects per-weekday overrides (weekends 120, weekdays 40)", () => {
    const p = profile({ daysPerWeek: 4, minutesPerDay: 40, minutesByWeekday: { 6: 120, 7: 120 } });
    const b = gen(p);
    for (const w of b.weeks) {
      assertSafe(p, w);
      const perDay = new Map<number, number>();
      for (const s of w.sessions) perDay.set(s.weekday, (perDay.get(s.weekday) ?? 0) + s.durationMin);
      for (const [d, m] of perDay) expect(m).toBeLessThanOrEqual(d >= 6 ? 120 : 40);
    }
    expect(b.weeks[0].sessions.some((s) => s.weekday >= 6)).toBe(true);
  });

  it("never plans on a day with zero minutes", () => {
    const p = profile({ daysPerWeek: 5, minutesByWeekday: { 2: 0, 4: 0 } });
    for (const w of gen(p).weeks) for (const s of w.sessions) expect([2, 4]).not.toContain(s.weekday);
  });

  it("returns an empty but valid plan when no day has time", () => {
    const b = gen(profile({ minutesPerDay: 0 }));
    expect(b.weeks.every((w) => w.sessions.length === 0)).toBe(true);
    expect(b.relaxations.length).toBeGreaterThan(0);
  });

  it("plans a race week, a race session and recovery weeks when the race is inside the block", () => {
    const p = profile({ daysPerWeek: 4, goal: { type: "race", distanceKm: 10, date: "2026-12-12" } }); // Saturday of week 3
    const b = gen(p);
    expect(b.weeks.map((w) => w.kind)).toEqual(["build", "build", "race", "recovery"]);
    const race = b.weeks[2].sessions.filter((s) => s.runType === "race");
    expect(race).toHaveLength(1);
    expect(race[0]).toMatchObject({ date: "2026-12-12", weekday: 6, intensity: "hard", rationale: "Race day", durationMin: 60 });
    // nothing else on race day or the day before; no heavy legs in the 3 days before
    for (const s of b.weeks[2].sessions) {
      if (s.runType === "race") continue;
      expect(["2026-12-11", "2026-12-12"]).not.toContain(s.date);
      expect(!(s.type === "lift" && s.heavyLower && s.date >= "2026-12-09" && s.date <= "2026-12-12")).toBe(true);
    }
    // recovery: no hard runs, lifts moderate, less running than the build peak
    const rec = b.weeks[3];
    expect(rec.sessions.filter((s) => s.type === "run").every((s) => s.intensity !== "hard")).toBe(true);
    expect(rec.sessions.filter((s) => s.type === "lift").every((s) => s.intensity === "moderate")).toBe(true);
    expect(rec.totals.runMin).toBeLessThan(b.weeks[1].totals.runMin);
    expect(b.weeks[2].totals.runMin - race[0].durationMin).toBeLessThan(b.weeks[1].totals.runMin);
    // race runs are exempt from the budget; everything else is not
    for (const w of b.weeks) expect(timeBudget.check(weekLayoutOf(p, w))).toEqual([]);
  });

  it("ignores a race date after the block and notes one before it", () => {
    const after = gen(profile({ goal: { type: "race", distanceKm: 10, date: "2027-06-01" } }));
    expect(after.weeks.map((w) => w.kind)).toEqual(["build", "build", "build", "deload"]);
    const before = gen(profile({ goal: { type: "race", distanceKm: 10, date: "2026-10-01" } }));
    expect(before.weeks.every((w) => w.sessions.every((s) => s.runType !== "race"))).toBe(true);
    expect(ids(before)).toContain("goalConflict");
  });
});

describe("contract", () => {
  it("is deterministic and does not mutate the profile", () => {
    const p = profile({ daysPerWeek: 5, restDays: [7], goal: { type: "race", distanceKm: 21.1, date: "2026-12-20" } });
    const snapshot = JSON.stringify(p);
    const a = gen(p);
    expect(gen(p)).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("throws for a start date that is not a valid Monday", () => {
    expect(() => generatePlan(profile(), { startDate: "2026-11-24" })).toThrow();
    expect(() => generatePlan(profile(), { startDate: "2026-02-30" })).toThrow();
    expect(() => generatePlan(profile(), { startDate: "nope" })).toThrow();
    expect(() => generatePlan(profile(), { startDate: START, weeks: 0 })).toThrow();
  });

  it("gives every session a rationale, a prescription and consistent totals", () => {
    const b = gen(profile({ daysPerWeek: 5, goal: { type: "race", distanceKm: 10, date: "2026-12-05" } }), 5);
    for (const w of b.weeks) {
      let runMin = 0;
      let liftSets = 0;
      for (const s of w.sessions) {
        expect(s.rationale.trim()).not.toBe("");
        expect(s.prescription.description.length).toBeGreaterThan(0);
        if (s.prescription.kind === "run") runMin += s.durationMin;
        else liftSets += s.prescription.totalSets;
      }
      expect(w.totals.runMin).toBe(runMin);
      expect(w.totals.liftSets).toBe(liftSets);
    }
  });

  it("keeps back-to-back hard days rare in normal plans", () => {
    const p = profile({ daysPerWeek: 4 });
    const l = weekLayoutOf(p, gen(p).weeks[0]);
    expect(avoidBackToBackHard.check(l).length).toBeLessThanOrEqual(1);
  });
});
