import { describe, expect, it } from "vitest";
import { conflictsByDate, conflictsBySession, conflictsTouching, detectConflicts, gapMinutes, type ConflictBusy, type ConflictSession } from "./conflicts";
import type { ConflictRule } from "./types";

let n = 0;
function s(partial: Partial<ConflictSession> & Pick<ConflictSession, "type" | "date">): ConflictSession {
  n += 1;
  return {
    id: partial.id ?? `s${n}`,
    status: "planned",
    startMin: null,
    durationMin: null,
    runType: partial.type === "run" ? "easy" : null,
    liftFocus: partial.type === "lift" ? "legs" : null,
    ...partial,
  };
}

const base = { user_id: "u", enabled: true, created_at: "2026-01-01T00:00:00Z" };

const legsNearHardRun: ConflictRule = {
  ...base,
  id: "r-min",
  name: "Heavy legs near a hard run",
  rule_type: "min_hours_between",
  session_type_a: "lift",
  session_type_b: "run",
  params: { hours: 24, a_lift_focus: ["legs", "lower", "full-body"], b_run_types: ["tempo", "interval", "long", "race"] },
};

const backToBack: ConflictRule = {
  ...base,
  id: "r-b2b",
  name: "No back-to-back hard days",
  rule_type: "no_back_to_back_hard",
  session_type_a: null,
  session_type_b: null,
  params: { hard_run_types: ["tempo", "interval", "long", "race"], hard_lift_focus: ["legs", "lower", "full-body"] },
};

const rest: ConflictRule = {
  ...base,
  id: "r-rest",
  name: "Rest at least once a week",
  rule_type: "max_days_without_rest",
  session_type_a: null,
  session_type_b: null,
  params: { max_days: 6 },
};

const busyRule: ConflictRule = {
  ...base,
  id: "r-busy",
  name: "Overlaps a busy block",
  rule_type: "busy_block_overlap",
  session_type_a: null,
  session_type_b: null,
  params: {},
};

describe("gapMinutes", () => {
  it("uses noon and 60 minutes when time and duration are missing", () => {
    const a = s({ type: "lift", date: "2026-11-02" });
    const b = s({ type: "run", date: "2026-11-03" });
    expect(gapMinutes(a, b)).toBe(23 * 60);
    expect(gapMinutes(b, a)).toBe(23 * 60);
  });

  it("measures end of the earlier to start of the later and goes negative on overlap", () => {
    const a = s({ type: "lift", date: "2026-11-02", startMin: 18 * 60, durationMin: 90 });
    const b = s({ type: "run", date: "2026-11-03", startMin: 6 * 60 });
    expect(gapMinutes(a, b)).toBe(10.5 * 60);
    const c = s({ type: "run", date: "2026-11-02", startMin: 18 * 60 + 30, durationMin: 30 });
    expect(gapMinutes(a, c)).toBeLessThan(0);
  });
});

describe("min_hours_between", () => {
  it("flags heavy legs the evening before a tempo run", () => {
    const lift = s({ type: "lift", date: "2026-11-02", startMin: 18 * 60, durationMin: 60, liftFocus: "Legs" });
    const run = s({ type: "run", date: "2026-11-03", startMin: 7 * 60, runType: "tempo" });
    const [c, ...rest] = detectConflicts([lift, run], [], [legsNearHardRun]);
    expect(rest).toHaveLength(0);
    expect(c.sessionIds).toEqual([lift.id, run.id]);
    expect(c.dates).toEqual(["2026-11-02", "2026-11-03"]);
    expect(c.message).toBe("Heavy legs near a hard run: Legs lift and tempo run are 12h apart, rule asks for 24h.");
  });

  it("works in either order (run before lift)", () => {
    const run = s({ type: "run", date: "2026-11-02", startMin: 7 * 60, runType: "interval" });
    const lift = s({ type: "lift", date: "2026-11-02", startMin: 17 * 60, liftFocus: "legs" });
    expect(detectConflicts([run, lift], [], [legsNearHardRun])).toHaveLength(1);
  });

  it("respects the threshold exactly (gap equal to the limit is fine)", () => {
    const lift = s({ type: "lift", date: "2026-11-02", startMin: 6 * 60, durationMin: 60 });
    const run = s({ type: "run", date: "2026-11-03", startMin: 7 * 60, runType: "tempo" });
    expect(gapMinutes(lift, run)).toBe(24 * 60);
    expect(detectConflicts([lift, run], [], [legsNearHardRun])).toHaveLength(0);
    const run2 = { ...run, startMin: 7 * 60 - 1 };
    expect(detectConflicts([lift, run2], [], [legsNearHardRun])).toHaveLength(1);
  });

  it("ignores sessions outside the filters", () => {
    const push = s({ type: "lift", date: "2026-11-02", liftFocus: "push" });
    const easy = s({ type: "run", date: "2026-11-02", runType: "easy" });
    const legs = s({ type: "lift", date: "2026-11-02", liftFocus: "legs" });
    const tempo = s({ type: "run", date: "2026-11-05", runType: "tempo" });
    expect(detectConflicts([push, easy, legs, tempo], [], [legsNearHardRun])).toHaveLength(0);
  });

  it("dedupes symmetric rules and reports overlaps", () => {
    const rule: ConflictRule = {
      ...legsNearHardRun,
      session_type_a: null,
      session_type_b: null,
      params: { hours: 4 },
    };
    const a = s({ type: "run", date: "2026-11-02", startMin: 7 * 60, durationMin: 60 });
    const b = s({ type: "lift", date: "2026-11-02", startMin: 7 * 60 + 30 });
    const out = detectConflicts([a, b], [], [rule]);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain("they overlap");
  });

  it("run filters only constrain runs and lift filters only lifts", () => {
    const rule: ConflictRule = {
      ...legsNearHardRun,
      session_type_a: null,
      session_type_b: null,
      params: { hours: 24, a_run_types: ["race"], b_run_types: ["race"] },
    };
    // Any lift matches both sides; the easy run matches neither.
    const lift1 = s({ type: "lift", date: "2026-11-02", liftFocus: "push" });
    const lift2 = s({ type: "lift", date: "2026-11-02", liftFocus: "pull", startMin: 18 * 60 });
    const easy = s({ type: "run", date: "2026-11-02", runType: "easy" });
    const out = detectConflicts([lift1, lift2, easy], [], [rule]);
    expect(out).toHaveLength(1);
    expect(out[0].sessionIds.sort()).toEqual([lift1.id, lift2.id].sort());
  });

  it("skips malformed params", () => {
    const rule = { ...legsNearHardRun, params: { hours: "x" } } as unknown as ConflictRule;
    const lift = s({ type: "lift", date: "2026-11-02" });
    const run = s({ type: "run", date: "2026-11-02", runType: "tempo" });
    expect(detectConflicts([lift, run], [], [rule])).toHaveLength(0);
  });
});

describe("no_back_to_back_hard", () => {
  it("flags hard sessions on consecutive days and the same day", () => {
    const tempo = s({ type: "run", date: "2026-11-02", runType: "tempo" });
    const legs = s({ type: "lift", date: "2026-11-03", liftFocus: "LEGS" });
    const intervals = s({ type: "run", date: "2026-11-03", runType: "interval" });
    const out = detectConflicts([tempo, legs, intervals], [], [backToBack]);
    expect(out).toHaveLength(3);
    expect(out.some((c) => c.message.includes("are both on Tue 3 Nov"))).toBe(true);
    expect(out.some((c) => c.message.includes("back-to-back days (Mon 2 Nov and Tue 3 Nov)"))).toBe(true);
  });

  it("allows a day between and ignores easy sessions", () => {
    const tempo = s({ type: "run", date: "2026-11-02", runType: "tempo" });
    const easy = s({ type: "run", date: "2026-11-03", runType: "easy" });
    const push = s({ type: "lift", date: "2026-11-03", liftFocus: "push" });
    const long = s({ type: "run", date: "2026-11-04", runType: "long" });
    expect(detectConflicts([tempo, easy, push, long], [], [backToBack])).toHaveLength(0);
  });
});

describe("max_days_without_rest", () => {
  it("flags streaks longer than the limit, across week boundaries", () => {
    const days = ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"];
    const sessions = days.map((d) => s({ type: "run", date: d }));
    const out = detectConflicts(sessions, [], [rest]);
    expect(out).toHaveLength(1);
    expect(out[0].dates).toEqual(days);
    expect(out[0].sessionIds).toHaveLength(7);
    expect(out[0].message).toContain("7 training days in a row");
  });

  it("allows exactly the limit, and skipped sessions count as rest", () => {
    const six = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"].map((d) =>
      s({ type: "lift", date: d }),
    );
    expect(detectConflicts(six, [], [rest])).toHaveLength(0);
    const seventhSkipped = s({ type: "run", date: "2026-11-08", status: "skipped" });
    expect(detectConflicts([...six, seventhSkipped], [], [rest])).toHaveLength(0);
    const seventh = s({ type: "run", date: "2026-11-08", status: "completed" });
    expect(detectConflicts([...six, seventh], [], [rest])).toHaveLength(1);
  });

  it("counts two sessions on one day once and reports separate streaks", () => {
    const rule: ConflictRule = { ...rest, params: { max_days: 1 } };
    const a = s({ type: "run", date: "2026-11-02" });
    const b = s({ type: "lift", date: "2026-11-02" });
    const c = s({ type: "run", date: "2026-11-03" });
    const d = s({ type: "run", date: "2026-11-05" });
    const e = s({ type: "run", date: "2026-11-06" });
    const out = detectConflicts([a, b, c, d, e], [], [rule]);
    expect(out).toHaveLength(2);
    expect(out[0].sessionIds).toEqual([a.id, b.id, c.id]);
  });
});

describe("busy_block_overlap", () => {
  const busy: ConflictBusy[] = [{ id: "b1", title: "Class", date: "2026-11-02", startMin: 9 * 60, endMin: 10 * 60 + 30 }];

  it("flags timed sessions overlapping a block", () => {
    const run = s({ type: "run", date: "2026-11-02", startMin: 10 * 60, durationMin: 45 });
    const [c] = detectConflicts([run], busy, [busyRule]);
    expect(c.sessionIds).toEqual([run.id]);
    expect(c.message).toBe('Overlaps a busy block: easy run at 10:00 overlaps "Class" (09:00–10:30).');
  });

  it("ignores touching edges, other days, and untimed sessions", () => {
    const before = s({ type: "run", date: "2026-11-02", startMin: 8 * 60, durationMin: 60 });
    const after = s({ type: "lift", date: "2026-11-02", startMin: 10 * 60 + 30 });
    const otherDay = s({ type: "run", date: "2026-11-03", startMin: 9 * 60 + 30 });
    const untimed = s({ type: "run", date: "2026-11-02" });
    expect(detectConflicts([before, after, otherDay, untimed], busy, [busyRule])).toHaveLength(0);
  });
});

describe("rule handling and indexes", () => {
  it("ignores disabled rules and skipped sessions; falls back to default names", () => {
    const lift = s({ type: "lift", date: "2026-11-02" });
    const run = s({ type: "run", date: "2026-11-02", runType: "tempo" });
    expect(detectConflicts([lift, run], [], [{ ...legsNearHardRun, enabled: false }])).toHaveLength(0);
    expect(detectConflicts([lift, { ...run, status: "skipped" }], [], [legsNearHardRun])).toHaveLength(0);
    const unnamed = detectConflicts([lift, run], [], [{ ...legsNearHardRun, name: null }]);
    expect(unnamed[0].ruleName).toBe("Minimum gap between sessions");
  });

  it("indexes by session and date and filters to a week", () => {
    const lift = s({ type: "lift", date: "2026-11-01", startMin: 20 * 60 });
    const run = s({ type: "run", date: "2026-11-02", startMin: 6 * 60, runType: "tempo" });
    const out = detectConflicts([lift, run], [], [legsNearHardRun]);
    expect(conflictsBySession(out).get(run.id)).toHaveLength(1);
    expect(conflictsByDate(out).get("2026-11-01")).toHaveLength(1);
    expect(conflictsTouching(out, ["2026-11-02"])).toHaveLength(1);
    expect(conflictsTouching(out, ["2026-11-09"])).toHaveLength(0);
  });
});
