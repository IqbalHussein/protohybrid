import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  conflictWindow,
  conflictsFor,
  findConflicts,
  matchesKeywords,
  type ConflictRule,
} from "./conflicts";
import type { BusyBlock, CalendarSession, RunType } from "./types";

// 2026-09-14 is a Monday; the app's zone is America/Toronto (UTC-4 in September).

function lift(id: string, date: string, focus: string, over: Partial<CalendarSession> = {}): CalendarSession {
  return {
    id,
    type: "lift",
    status: "planned",
    plannedDate: date,
    startMin: null,
    durationMin: null,
    routineId: null,
    adHoc: false,
    run: null,
    lift: { focus, notes: null, started_at: null, completed_at: null },
    ...over,
  };
}

function run(id: string, date: string, runType: RunType, over: Partial<CalendarSession> = {}): CalendarSession {
  return {
    id,
    type: "run",
    status: "planned",
    plannedDate: date,
    startMin: null,
    durationMin: null,
    routineId: null,
    adHoc: false,
    run: {
      run_type: runType,
      target_distance_km: null,
      target_pace_sec_per_km: null,
      target_duration_sec: null,
      actual_distance_km: null,
      actual_pace_sec_per_km: null,
      actual_duration_sec: null,
      strava_activity_id: null,
      actual_avg_hr: null,
      actual_elevation_m: null,
      strava_name: null,
    },
    lift: null,
    ...over,
  };
}

const at = (hour: number) => ({ startMin: hour * 60 });

/** The defaults, one at a time, with ids so conflicts can be traced to them. */
const rules = DEFAULT_RULES.map((r, i) => ({ ...r, id: `r${i}` }) as ConflictRule);
const [legsBeforeHardRun, backToBack, restDays, overlap] = rules;

describe("min_hours_between", () => {
  it("flags heavy legs the evening before a morning tempo run", () => {
    const sessions = [lift("legs", "2026-09-15", "Legs", at(18)), run("tempo", "2026-09-16", "tempo", at(7))];
    const conflicts = findConflicts(sessions, [], [legsBeforeHardRun]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].sessionIds).toEqual(["legs", "tempo"]);
    expect(conflicts[0].message).toBe("Legs (Tue 15) is 13h before Tempo run (Wed 16) — rule: 24h apart");
  });

  it("flags the run-then-legs order too", () => {
    const sessions = [run("tempo", "2026-09-15", "tempo", at(7)), lift("legs", "2026-09-15", "Lower body", at(18))];
    expect(findConflicts(sessions, [], [legsBeforeHardRun]).map((c) => c.sessionIds)).toEqual([["tempo", "legs"]]);
  });

  it("leaves sessions far enough apart alone", () => {
    const sessions = [lift("legs", "2026-09-14", "Legs", at(18)), run("tempo", "2026-09-16", "tempo", at(7))];
    expect(findConflicts(sessions, [], [legsBeforeHardRun])).toEqual([]);
  });

  it("only matches the sides the rule narrows to", () => {
    const sessions = [lift("push", "2026-09-15", "Push", at(18)), run("easy", "2026-09-16", "easy", at(7))];
    expect(findConflicts(sessions, [], [legsBeforeHardRun])).toEqual([]);
  });

  it("reports a pair once when both sides of the rule match both sessions", () => {
    const anyRuns: ConflictRule = {
      id: "runs",
      name: null,
      rule_type: "min_hours_between",
      enabled: true,
      params: { hours: 12, a: { type: "run" }, b: { type: "run" } },
    };
    const sessions = [run("am", "2026-09-15", "easy", at(7)), run("pm", "2026-09-15", "easy", at(17))];
    expect(findConflicts(sessions, [], [anyRuns]).map((c) => c.sessionIds)).toEqual([["am", "pm"]]);
  });
});

describe("no_back_to_back_hard", () => {
  it("flags hard sessions on consecutive days", () => {
    const sessions = [run("intervals", "2026-09-15", "interval"), lift("legs", "2026-09-16", "legs")];
    const conflicts = findConflicts(sessions, [], [backToBack]);
    expect(conflicts.map((c) => c.sessionIds)).toEqual([["intervals", "legs"]]);
    expect(conflicts[0].message).toMatch(/^Hard sessions back to back/);
  });

  it("flags two hard sessions on one day", () => {
    const sessions = [run("tempo", "2026-09-15", "tempo", at(7)), run("race", "2026-09-15", "race", at(18))];
    expect(findConflicts(sessions, [], [backToBack])[0].message).toMatch(/^Two hard sessions on one day/);
  });

  it("ignores easy sessions and a gap day", () => {
    const sessions = [
      run("tempo", "2026-09-14", "tempo"),
      run("easy", "2026-09-15", "easy"),
      run("race", "2026-09-16", "race"),
    ];
    expect(findConflicts(sessions, [], [backToBack])).toEqual([]);
  });

  it("treats no lift as hard when the keyword list is empty", () => {
    const rule: ConflictRule = {
      ...(backToBack as Extract<ConflictRule, { rule_type: "no_back_to_back_hard" }>),
      params: { hard_run_types: [], hard_lift_keywords: [] },
    };
    const sessions = [lift("a", "2026-09-15", "Legs"), lift("b", "2026-09-16", "Legs")];
    expect(findConflicts(sessions, [], [rule])).toEqual([]);
  });
});

describe("max_days_without_rest", () => {
  const streak = (days: number, start = 14) =>
    Array.from({ length: days }, (_, i) => run(`d${i}`, `2026-09-${start + i}`, "easy"));

  it("flags the seventh straight training day, once", () => {
    const conflicts = findConflicts(streak(9), [], [restDays]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].sessionIds).toEqual(["d6"]);
    expect(conflicts[0].message).toBe("7 training days in a row by Sun 20 — rule: rest at least every 7 days");
  });

  it("is satisfied by six days on and a rest day", () => {
    const sessions = [...streak(6), run("next", "2026-09-21", "easy")];
    expect(findConflicts(sessions, [], [restDays])).toEqual([]);
  });

  it("counts two sessions on one day as one training day", () => {
    const sessions = [...streak(6), lift("extra", "2026-09-19", "push")];
    expect(findConflicts(sessions, [], [restDays])).toEqual([]);
  });
});

describe("busy_block_overlap", () => {
  const lecture: BusyBlock = {
    id: "b1",
    title: "Lecture",
    startTime: "2026-09-16T13:00:00Z", // 9am Toronto
    endTime: "2026-09-16T15:00:00Z", // 11am Toronto
    source: "manual",
  };

  it("flags a timed session that overlaps a commitment", () => {
    const sessions = [run("r", "2026-09-16", "easy", { startMin: 10 * 60, durationMin: 45 })];
    const conflicts = findConflicts(sessions, [lecture], [overlap]);
    expect(conflicts.map((c) => c.message)).toEqual(["Easy run (Wed 16) overlaps “Lecture”"]);
  });

  it("assumes an hour when no duration was planned, like the grid draws it", () => {
    const sessions = [run("r", "2026-09-16", "easy", { startMin: 8 * 60 + 30 })];
    expect(findConflicts(sessions, [lecture], [overlap])).toHaveLength(1);
  });

  it("does not flag a session that ends as the commitment starts", () => {
    const sessions = [run("r", "2026-09-16", "easy", { startMin: 8 * 60, durationMin: 60 })];
    expect(findConflicts(sessions, [lecture], [overlap])).toEqual([]);
  });

  it("never flags an untimed session", () => {
    expect(findConflicts([run("r", "2026-09-16", "easy")], [lecture], [overlap])).toEqual([]);
  });
});

describe("findConflicts", () => {
  const clash = [lift("legs", "2026-09-15", "Legs", at(18)), run("tempo", "2026-09-16", "tempo", at(7))];

  it("skips ad-hoc sessions entirely", () => {
    const sessions = [clash[0], { ...clash[1], adHoc: true }];
    expect(findConflicts(sessions, [], rules)).toEqual([]);
  });

  it("skips skipped sessions", () => {
    const sessions = [clash[0], { ...clash[1], status: "skipped" as const }];
    expect(findConflicts(sessions, [], rules)).toEqual([]);
  });

  it("ignores disabled rules", () => {
    expect(findConflicts(clash, [], [{ ...legsBeforeHardRun, enabled: false }])).toEqual([]);
  });

  it("attaches a conflict to every session it names", () => {
    const conflicts = findConflicts(clash, [], [legsBeforeHardRun]);
    expect(conflictsFor(conflicts, "legs")).toHaveLength(1);
    expect(conflictsFor(conflicts, "tempo")).toHaveLength(1);
    expect(conflictsFor(conflicts, "other")).toHaveLength(0);
  });
});

describe("matchesKeywords", () => {
  it("ignores case and punctuation", () => {
    expect(matchesKeywords("Full-Body A", ["full body"])).toBe(true);
    expect(matchesKeywords("Legs & core", ["LEGS"])).toBe(true);
    expect(matchesKeywords("Push", ["legs"])).toBe(false);
  });

  it("matches anything when no keywords are given, but not a missing focus when some are", () => {
    expect(matchesKeywords("Push", [])).toBe(true);
    expect(matchesKeywords(null, ["legs"])).toBe(false);
  });
});

describe("conflictWindow", () => {
  it("reaches back far enough to see a rest-day streak that breaks on Monday", () => {
    expect(conflictWindow("2026-09-14", rules)).toEqual({ from: "2026-09-08", to: "2026-09-27" });
  });

  it("still pads a day with no rules, for anything crossing midnight", () => {
    expect(conflictWindow("2026-09-14", [])).toEqual({ from: "2026-09-13", to: "2026-09-22" });
  });
});
