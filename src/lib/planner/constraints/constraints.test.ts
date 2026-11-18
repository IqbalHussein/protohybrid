import { describe, expect, it } from "vitest";
import { CONSTRAINTS, WEEK_CONSTRAINTS, BLOCK_CONSTRAINTS } from "./index";
import { avoidBackToBackHard } from "./avoidBackToBackHard";
import { avoidLegsAfterHardRun } from "./avoidLegsAfterHardRun";
import { deloadReduction } from "./deloadReduction";
import { liftProgression } from "./liftProgression";
import { longRunWhenEndurance } from "./longRunWhenEndurance";
import { maxConsecutiveHardDays } from "./maxConsecutiveHardDays";
import { minSessionLength } from "./minSessionLength";
import { noHeavyLowerBeforeHardRun } from "./noHeavyLowerBeforeHardRun";
import { protectLongRun } from "./protectLongRun";
import { respectRestDays } from "./respectRestDays";
import { runIntensityDistribution } from "./runIntensityDistribution";
import { runVolumeProgression } from "./runVolumeProgression";
import { spreadKeyRuns } from "./spreadKeyRuns";
import { spreadLifts } from "./spreadLifts";
import { stackHardSessions } from "./stackHardSessions";
import { timeBudget } from "./timeBudget";
import {
  block,
  easyRun,
  intervalRun,
  layout,
  legLift,
  longRun,
  sess,
  tempoRun,
  upperLift,
} from "../testkit";

describe("registry", () => {
  it("lists every constraint once with the contract ids", () => {
    const ids = CONSTRAINTS.map((c) => c.id).sort();
    expect(ids).toEqual(
      [
        "avoidBackToBackHard",
        "avoidLegsAfterHardRun",
        "deloadReduction",
        "liftProgression",
        "longRunWhenEndurance",
        "maxConsecutiveHardDays",
        "minSessionLength",
        "noHeavyLowerBeforeHardRun",
        "protectLongRun",
        "respectRestDays",
        "runIntensityDistribution",
        "runVolumeProgression",
        "spreadKeyRuns",
        "spreadLifts",
        "stackHardSessions",
        "timeBudget",
      ].sort(),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares scope and severity consistently", () => {
    expect(WEEK_CONSTRAINTS.every((c) => c.scope === "week")).toBe(true);
    expect(BLOCK_CONSTRAINTS.every((c) => c.scope === "block")).toBe(true);
    const hard = CONSTRAINTS.filter((c) => c.severity === "hard").map((c) => c.id);
    expect(hard.sort()).toEqual(
      ["maxConsecutiveHardDays", "minSessionLength", "noHeavyLowerBeforeHardRun", "runVolumeProgression", "timeBudget"].sort(),
    );
    for (const c of CONSTRAINTS) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.weight).toBeGreaterThan(0);
    }
  });

  it("produces violations that carry their constraint id", () => {
    const l = layout({ days: { 1: [legLift(), tempoRun()] } });
    for (const c of WEEK_CONSTRAINTS) for (const v of c.check(l)) expect(v.constraint).toBe(c.id);
  });
});

describe("timeBudget", () => {
  it("passes when a day fits its budget", () => {
    expect(timeBudget.check(layout({ days: { 1: [easyRun(25), upperLift(35)] } }))).toEqual([]);
  });
  it("flags stacked sessions that share more than the day's budget", () => {
    const v = timeBudget.check(layout({ days: { 1: [easyRun(30), upperLift(40)] } }));
    expect(v).toHaveLength(1);
    expect(v[0].weekday).toBe(1);
  });
  it("uses per-weekday budgets", () => {
    const l = layout({ days: { 6: [longRun(90)] }, budget: { 6: 120 } });
    expect(timeBudget.check(l)).toEqual([]);
    expect(timeBudget.check(layout({ days: { 6: [longRun(90)] }, budget: 60 }))).toHaveLength(1);
  });
  it("exempts race runs", () => {
    const race = sess({ runType: "race", intensity: "hard", durationMin: 250 });
    expect(timeBudget.check(layout({ days: { 7: [race] } }))).toEqual([]);
  });
});

describe("noHeavyLowerBeforeHardRun", () => {
  it("passes with a day between a heavy lift and a hard run", () => {
    expect(noHeavyLowerBeforeHardRun.check(layout({ days: { 1: [legLift()], 3: [tempoRun()] } }))).toEqual([]);
  });
  it("flags a heavy lower lift the day before a tempo run", () => {
    const v = noHeavyLowerBeforeHardRun.check(layout({ days: { 1: [legLift()], 2: [tempoRun()] } }));
    expect(v).toHaveLength(1);
    expect(v[0].weekday).toBe(2);
  });
  it("flags it for interval runs and across Sunday to Monday", () => {
    const l = layout({ days: { 7: [legLift()], 1: [intervalRun()] } });
    expect(noHeavyLowerBeforeHardRun.check(l)).toHaveLength(1);
  });
  it("allows the same day when the run is AM and the lift PM", () => {
    expect(noHeavyLowerBeforeHardRun.check(layout({ days: { 2: [tempoRun(), legLift()] } }))).toEqual([]);
  });
  it("flags the same day when the lift comes first", () => {
    expect(noHeavyLowerBeforeHardRun.check(layout({ days: { 2: [legLift(), tempoRun()] } }))).toHaveLength(1);
  });
  it("flags a PM lift before next morning's run", () => {
    const l = layout({ days: { 1: [easyRun(20), legLift(35)], 2: [tempoRun()] } });
    expect(noHeavyLowerBeforeHardRun.check(l)).toHaveLength(1);
  });
  it("ignores upper-body lifts and easy or long runs", () => {
    const l = layout({ days: { 1: [upperLift()], 2: [tempoRun()], 3: [legLift()], 4: [easyRun()], 5: [longRun()] } });
    expect(noHeavyLowerBeforeHardRun.check(l)).toEqual([]);
  });
});

describe("maxConsecutiveHardDays", () => {
  it("passes with two hard days in a row", () => {
    expect(maxConsecutiveHardDays.check(layout({ days: { 2: [tempoRun()], 3: [legLift()] } }))).toEqual([]);
  });
  it("flags three in a row", () => {
    const l = layout({ days: { 2: [tempoRun()], 3: [legLift()], 4: [intervalRun()] } });
    const v = maxConsecutiveHardDays.check(l);
    expect(v).toHaveLength(1);
    expect(v[0].weekday).toBe(2);
  });
  it("wraps from Sunday to Monday", () => {
    const l = layout({ days: { 6: [tempoRun()], 7: [legLift()], 1: [intervalRun()] } });
    expect(maxConsecutiveHardDays.check(l)).toHaveLength(1);
  });
  it("does not count easy or moderate days", () => {
    const l = layout({ days: { 2: [tempoRun()], 3: [upperLift()], 4: [intervalRun()] } });
    expect(maxConsecutiveHardDays.check(l)).toEqual([]);
  });
  it("flags a week that is hard every day", () => {
    const days: Record<number, ReturnType<typeof tempoRun>[]> = {};
    for (let d = 1; d <= 7; d++) days[d] = [tempoRun()];
    expect(maxConsecutiveHardDays.check(layout({ days }))).toHaveLength(1);
  });
});

describe("minSessionLength", () => {
  it("passes at the minimums", () => {
    const l = layout({ days: { 1: [upperLift(30)], 2: [easyRun(20)], 3: [tempoRun(25)] } });
    expect(minSessionLength.check(l)).toEqual([]);
  });
  it("flags short lifts, easy runs and hard runs", () => {
    const l = layout({ days: { 1: [upperLift(25)], 2: [easyRun(15)], 3: [tempoRun(20)], 4: [longRun(15)] } });
    expect(minSessionLength.check(l)).toHaveLength(4);
  });
  it("exempts race runs", () => {
    expect(minSessionLength.check(layout({ days: { 7: [sess({ runType: "race", durationMin: 10 })] } }))).toEqual([]);
  });
});

describe("runIntensityDistribution", () => {
  it("passes near 80/20", () => {
    const l = layout({ days: { 1: [easyRun(40)], 3: [tempoRun(30, { hardMin: 20 })], 6: [longRun(50)] } });
    expect(runIntensityDistribution.check(l)).toEqual([]); // 20 / 120
  });
  it("counts the long run as easy", () => {
    const l = layout({ days: { 1: [tempoRun(30, { hardMin: 12 })], 6: [longRun(60)] } });
    expect(runIntensityDistribution.check(l)).toEqual([]); // 12 / 90
  });
  it("flags too much hard running", () => {
    const l = layout({ days: { 1: [easyRun(30)], 3: [tempoRun(40, { hardMin: 30 })], 5: [intervalRun(35, { hardMin: 20 })] } });
    expect(runIntensityDistribution.check(l)).toHaveLength(1);
  });
  it("flags weeks with no hard running when there is enough running", () => {
    const l = layout({ days: { 1: [easyRun(40)], 3: [easyRun(40)], 6: [longRun(60)] } });
    expect(runIntensityDistribution.check(l)).toHaveLength(1);
  });
  it("ignores very short weeks and race weeks", () => {
    expect(runIntensityDistribution.check(layout({ days: { 1: [easyRun(30)] } }))).toEqual([]);
    const race = layout({ kind: "race", days: { 1: [tempoRun(40, { hardMin: 40 })], 3: [easyRun(30)] } });
    expect(runIntensityDistribution.check(race)).toEqual([]);
  });
});

describe("longRunWhenEndurance", () => {
  it("passes with exactly one long run", () => {
    expect(longRunWhenEndurance.check(layout({ wantsLongRun: true, days: { 6: [longRun()] } }))).toEqual([]);
  });
  it("flags a missing or duplicated long run", () => {
    expect(longRunWhenEndurance.check(layout({ wantsLongRun: true, days: { 2: [easyRun()] } }))).toHaveLength(1);
    expect(longRunWhenEndurance.check(layout({ wantsLongRun: true, days: { 5: [longRun()], 6: [longRun()] } }))).toHaveLength(1);
  });
  it("asks for nothing when endurance is low", () => {
    expect(longRunWhenEndurance.check(layout({ wantsLongRun: false, days: { 2: [easyRun()] } }))).toEqual([]);
  });
});

describe("stackHardSessions", () => {
  it("passes when the hard run and hard lift share a day", () => {
    const l = layout({ days: { 2: [tempoRun(25), legLift(35)], 5: [easyRun()] } });
    expect(stackHardSessions.check(l)).toEqual([]);
  });
  it("penalises each extra day with hard sessions", () => {
    const l = layout({ days: { 1: [legLift()], 3: [tempoRun()], 5: [upperLift()] } });
    expect(stackHardSessions.check(l)).toHaveLength(1);
    const spread = layout({ days: { 1: [legLift()], 3: [tempoRun()], 5: [legLift()] } });
    expect(stackHardSessions.check(spread)).toHaveLength(1); // 3 hard days, 2 would do
  });
  it("is quiet when nothing is hard", () => {
    expect(stackHardSessions.check(layout({ days: { 1: [easyRun()], 2: [upperLift()] } }))).toEqual([]);
  });
});

describe("respectRestDays", () => {
  it("passes when rest days are free", () => {
    expect(respectRestDays.check(layout({ restDays: [3], days: { 1: [easyRun()] } }))).toEqual([]);
  });
  it("flags a session on a rest day", () => {
    const v = respectRestDays.check(layout({ restDays: [3, 7], days: { 3: [easyRun()], 7: [longRun()] } }));
    expect(v.map((x) => x.weekday)).toEqual([3, 7]);
  });
});

describe("protectLongRun", () => {
  it("passes with a gap before the long run", () => {
    expect(protectLongRun.check(layout({ days: { 4: [legLift()], 6: [longRun()] } }))).toEqual([]);
  });
  it("flags a heavy lower lift the day before the long run", () => {
    expect(protectLongRun.check(layout({ days: { 5: [legLift()], 6: [longRun()] } }))).toHaveLength(1);
  });
  it("allows an upper lift the day before and an AM long run with a PM lift", () => {
    expect(protectLongRun.check(layout({ days: { 5: [upperLift()], 6: [longRun(), legLift()] } }))).toEqual([]);
  });
});

describe("avoidLegsAfterHardRun", () => {
  it("passes with upper body on the hard-run day and legs two days later", () => {
    const l = layout({ days: { 2: [tempoRun(25), upperLift(35)], 4: [legLift()] } });
    expect(avoidLegsAfterHardRun.check(l)).toEqual([]);
  });
  it("flags heavy legs on the same day or the day after a hard run", () => {
    expect(avoidLegsAfterHardRun.check(layout({ days: { 2: [tempoRun(25), legLift(35)] } }))).toHaveLength(1);
    expect(avoidLegsAfterHardRun.check(layout({ days: { 2: [intervalRun()], 3: [legLift()] } }))).toHaveLength(1);
  });
});

describe("spreadLifts", () => {
  it("passes when consecutive lifts hit different regions", () => {
    const l = layout({ days: { 1: [upperLift()], 2: [legLift()], 3: [upperLift()] } });
    expect(spreadLifts.check(l)).toEqual([]);
  });
  it("flags the same region on consecutive days, including Sunday to Monday", () => {
    expect(spreadLifts.check(layout({ days: { 1: [upperLift()], 2: [upperLift()] } }))).toHaveLength(1);
    expect(spreadLifts.check(layout({ days: { 7: [legLift()], 1: [legLift()] } }))).toHaveLength(1);
  });
  it("treats full-body lifts as their own region", () => {
    const fb = (o = {}) => sess({ type: "lift", runType: null, liftFocus: "full-body", heavyLower: true, intensity: "moderate", ...o });
    expect(spreadLifts.check(layout({ days: { 1: [fb()], 2: [upperLift()] } }))).toEqual([]);
    expect(spreadLifts.check(layout({ days: { 1: [fb()], 2: [fb()] } }))).toHaveLength(1);
  });
});

describe("spreadKeyRuns", () => {
  it("passes when key runs have a day between them", () => {
    const l = layout({ days: { 2: [intervalRun()], 4: [tempoRun()], 6: [longRun()] } });
    expect(spreadKeyRuns.check(l)).toEqual([]);
  });
  it("ignores easy runs and lifts next to key runs", () => {
    const l = layout({ days: { 2: [tempoRun()], 3: [easyRun()], 4: [upperLift()], 5: [longRun()], 6: [legLift()] } });
    expect(spreadKeyRuns.check(l)).toEqual([]);
  });
  it("charges back-to-back hard runs more than a pair that involves the long run", () => {
    const hard = spreadKeyRuns.check(layout({ days: { 2: [intervalRun()], 3: [tempoRun()] } }));
    const long = spreadKeyRuns.check(layout({ days: { 3: [tempoRun()], 4: [longRun()] } }));
    expect(hard).toHaveLength(1);
    expect(long).toHaveLength(1);
    expect(hard[0].weight!).toBeGreaterThan(long[0].weight!);
    expect(long[0].weight!).toBeGreaterThan(6); // dearer than stacking hard sessions
  });
  it("counts each pair, including three in a row and Sunday to Monday", () => {
    expect(spreadKeyRuns.check(layout({ days: { 1: [intervalRun()], 2: [tempoRun()], 3: [longRun()] } }))).toHaveLength(2);
    expect(spreadKeyRuns.check(layout({ days: { 7: [longRun()], 1: [tempoRun()] } }))).toHaveLength(1);
  });
  it("counts a key run stacked with a lift", () => {
    const l = layout({ days: { 2: [tempoRun(25), legLift(35)], 3: [longRun()] } });
    expect(spreadKeyRuns.check(l)).toHaveLength(1);
  });
});

describe("avoidBackToBackHard", () => {
  it("passes when hard days are apart", () => {
    expect(avoidBackToBackHard.check(layout({ days: { 1: [tempoRun()], 3: [legLift()] } }))).toEqual([]);
  });
  it("counts each pair of consecutive hard days, wrapping the week", () => {
    expect(avoidBackToBackHard.check(layout({ days: { 1: [tempoRun()], 2: [legLift()] } }))).toHaveLength(1);
    expect(avoidBackToBackHard.check(layout({ days: { 7: [tempoRun()], 1: [legLift()], 2: [intervalRun()] } }))).toHaveLength(2);
  });
});

describe("runVolumeProgression", () => {
  const w = (kind: "build" | "deload" | "race" | "recovery", runMin: number) => ({ kind, runMin, liftSets: 0 });
  it("passes up to +10%", () => {
    expect(runVolumeProgression.check(block([w("build", 100), w("build", 110), w("build", 121)]))).toEqual([]);
  });
  it("flags more than +10%", () => {
    const v = runVolumeProgression.check(block([w("build", 100), w("build", 112)]));
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("Week 2");
  });
  it("skips deload weeks as the reference", () => {
    // build 120 -> deload 72 -> build 130 is +8% over the previous *build* week
    expect(runVolumeProgression.check(block([w("build", 120), w("deload", 72), w("build", 130)]))).toEqual([]);
    expect(runVolumeProgression.check(block([w("build", 100), w("deload", 60), w("build", 115)]))).toHaveLength(1);
  });
  it("ignores recovery and race weeks", () => {
    expect(runVolumeProgression.check(block([w("build", 100), w("race", 200), w("recovery", 300)]))).toEqual([]);
  });
});

describe("deloadReduction", () => {
  const b = (runMin: number, liftSets: number) => block([{ kind: "build", runMin: 100, liftSets: 20 }, { kind: "deload", runMin, liftSets }]);
  it("passes around 60%", () => {
    expect(deloadReduction.check(b(60, 12))).toEqual([]);
    expect(deloadReduction.check(b(50, 14))).toEqual([]);
  });
  it("flags runs or lifts outside 50-70%", () => {
    expect(deloadReduction.check(b(80, 12))).toHaveLength(1);
    expect(deloadReduction.check(b(60, 6))).toHaveLength(1);
    expect(deloadReduction.check(b(90, 18))).toHaveLength(2);
  });
  it("has nothing to compare when there are no runs", () => {
    const none = block([{ kind: "build", runMin: 0, liftSets: 20 }, { kind: "deload", runMin: 0, liftSets: 12 }]);
    expect(deloadReduction.check(none)).toEqual([]);
  });
});

describe("liftProgression", () => {
  it("passes when sets and RPE do not fall between build weeks", () => {
    const b = block([
      { kind: "build", runMin: 0, liftSets: 20, rpe: 7 },
      { kind: "build", runMin: 0, liftSets: 20, rpe: 7.5 },
      { kind: "build", runMin: 0, liftSets: 22, rpe: 8 },
      { kind: "deload", runMin: 0, liftSets: 12, rpe: 6 },
    ]);
    expect(liftProgression.check(b)).toEqual([]);
  });
  it("flags fewer sets or lower RPE", () => {
    const sets = block([{ kind: "build", runMin: 0, liftSets: 20 }, { kind: "build", runMin: 0, liftSets: 18 }]);
    expect(liftProgression.check(sets)).toHaveLength(1);
    const rpe = block([
      { kind: "build", runMin: 0, liftSets: 20, rpe: 8 },
      { kind: "build", runMin: 0, liftSets: 20, rpe: 7 },
    ]);
    expect(liftProgression.check(rpe)).toHaveLength(1);
  });
  it("does not compare a build week with the week after a deload", () => {
    const b = block([
      { kind: "build", runMin: 0, liftSets: 22, rpe: 8 },
      { kind: "deload", runMin: 0, liftSets: 13, rpe: 6 },
      { kind: "build", runMin: 0, liftSets: 20, rpe: 7 },
    ]);
    expect(liftProgression.check(b)).toEqual([]);
  });
});
