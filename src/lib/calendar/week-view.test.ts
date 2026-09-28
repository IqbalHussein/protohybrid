import { describe, expect, it } from "vitest";
import { buildWeekView } from "./week-view";
import type { BusyBlock, CalendarSession, Week } from "./types";
import { weekDates } from "@/lib/week";

const WEEK_START = "2026-09-14"; // a Monday
const NOW = new Date("2026-09-16T15:00:00Z"); // Wednesday, 11am in Toronto

function session(over: Partial<CalendarSession> = {}): CalendarSession {
  return {
    id: "s1",
    type: "lift",
    status: "planned",
    plannedDate: "2026-09-16",
    startMin: null,
    durationMin: null,
    routineId: null,
    adHoc: false,
    run: null,
    lift: { focus: "push", notes: null, started_at: null, completed_at: null },
    ...over,
  };
}

function week(over: Partial<Week> = {}): Week {
  return {
    weekStart: WEEK_START,
    dates: weekDates(WEEK_START),
    sessions: [],
    busyBlocks: [],
    ...over,
  };
}

const block = (over: Partial<BusyBlock> = {}): BusyBlock => ({
  id: "b1",
  title: "Lecture",
  startTime: "2026-09-16T13:00:00Z", // 9am Toronto
  endTime: "2026-09-16T15:00:00Z", // 11am Toronto
  source: "manual",
  ...over,
});

describe("buildWeekView", () => {
  it("renders seven columns and marks today", () => {
    const view = buildWeekView(week(), { now: NOW });
    expect(view.days).toHaveLength(7);
    expect(view.days.filter((d) => d.isToday).map((d) => d.date)).toEqual(["2026-09-16"]);
    expect(view.days.filter((d) => d.isPast).map((d) => d.date)).toEqual([
      "2026-09-14",
      "2026-09-15",
    ]);
  });

  it("creates nothing and warns about nothing for an empty week", () => {
    const view = buildWeekView(week(), { now: NOW });
    expect(view.warnings).toEqual([]);
    expect(view.days.every((d) => !d.untimed.length && !d.timed.length && !d.busy.length)).toBe(true);
  });

  it("pins an untimed session above the timed grid rather than placing it at midnight", () => {
    const view = buildWeekView(week({ sessions: [session()] }), { now: NOW });
    const day = view.days.find((d) => d.date === "2026-09-16")!;
    expect(day.untimed.map((s) => s.id)).toEqual(["s1"]);
    expect(day.timed).toHaveLength(0);
  });

  it("places a timed session and falls back to an hour with no planned duration", () => {
    const view = buildWeekView(week({ sessions: [session({ startMin: 18 * 60 })] }), { now: NOW });
    const [card] = view.days.find((d) => d.date === "2026-09-16")!.timed;
    expect(card.assumedDuration).toBe(true);
    expect(card.heightPct).toBeGreaterThan(0);
    expect(card.topPct).toBeGreaterThan(0);
  });

  it("converts a busy block through the app's zone, not UTC", () => {
    const view = buildWeekView(week({ busyBlocks: [block()] }), { now: NOW });
    const day = view.days.find((d) => d.date === "2026-09-16")!;
    expect(day.busy).toHaveLength(1);
    // 9am–11am in a 6am–10pm window: an eighth of the way down, an eighth tall.
    expect(day.busy[0].topPct).toBeCloseTo(18.75, 5);
    expect(day.busy[0].heightPct).toBeCloseTo(12.5, 5);
  });

  it("draws an overnight block on both days and says which edge it runs past", () => {
    const view = buildWeekView(
      week({
        busyBlocks: [
          block({ startTime: "2026-09-17T02:00:00Z", endTime: "2026-09-17T10:00:00Z" }),
        ],
      }),
      { now: NOW },
    );

    const wednesday = view.days.find((d) => d.date === "2026-09-16")!;
    const thursday = view.days.find((d) => d.date === "2026-09-17")!;
    expect(wednesday.busy[0].label).toBe("Lecture →");
    expect(thursday.busy[0].label).toBe("→ Lecture");
  });

  it("widens the window so an early session is not clipped off the top", () => {
    const view = buildWeekView(
      week({ sessions: [session({ type: "run", startMin: 5 * 60, run: null })] }),
      { now: NOW },
    );
    expect(view.window.startMin).toBe(5 * 60);
    expect(view.hourMarks[0]).toBe(5 * 60);
  });

  it("flags a planned session whose day has passed instead of auto-skipping it", () => {
    const view = buildWeekView(
      week({ sessions: [session({ plannedDate: "2026-09-14" })] }),
      { now: NOW },
    );
    const card = view.days.find((d) => d.date === "2026-09-14")!.untimed[0];
    expect(card.unresolved).toBe(true);
    expect(card.status).toBe("planned");
  });

  it("does not flag a completed or skipped session in the past", () => {
    const view = buildWeekView(
      week({
        sessions: [
          session({ id: "done", plannedDate: "2026-09-14", status: "completed" }),
          session({ id: "skipped", plannedDate: "2026-09-14", status: "skipped" }),
        ],
      }),
      { now: NOW },
    );
    expect(view.days.find((d) => d.date === "2026-09-14")!.untimed.every((s) => !s.unresolved)).toBe(
      true,
    );
  });

  it("titles a run by its type and a lift by its focus", () => {
    const view = buildWeekView(
      week({
        sessions: [
          session({ id: "run", type: "run", lift: null, run: runDetails({ run_type: "tempo" }) }),
          session({ id: "lift" }),
        ],
      }),
      { now: NOW },
    );
    const titles = view.days.find((d) => d.date === "2026-09-16")!.untimed.map((s) => s.title);
    expect(titles).toContain("Tempo run");
    expect(titles).toContain("push");
  });

  it("subtitles a planned run with its targets and a completed one with its actuals", () => {
    const view = buildWeekView(
      week({
        sessions: [
          session({
            id: "planned",
            type: "run",
            lift: null,
            run: runDetails({ target_distance_km: 10, target_pace_sec_per_km: 330 }),
          }),
          session({
            id: "done",
            type: "run",
            status: "completed",
            lift: null,
            run: runDetails({ actual_distance_km: 10.2, actual_duration_sec: 3300 }),
          }),
        ],
      }),
      { now: NOW },
    );

    const cards = view.days.find((d) => d.date === "2026-09-16")!.untimed;
    expect(cards.find((c) => c.id === "planned")!.subtitle).toBe("10 km · 5:30 /km");
    expect(cards.find((c) => c.id === "done")!.subtitle).toBe("10.2 km · 55m");
  });

  it("subtitles a lift with its logged set count", () => {
    const view = buildWeekView(week({ sessions: [session({ status: "completed" })] }), {
      now: NOW,
      setCounts: new Map([["s1", 12]]),
    });
    expect(view.days.find((d) => d.date === "2026-09-16")!.untimed[0].subtitle).toBe("12 sets logged");
  });

  it("offers a lift to the logger until it is complete", () => {
    const open = buildWeekView(week({ sessions: [session()] }), { now: NOW });
    const done = buildWeekView(week({ sessions: [session({ status: "completed" })] }), { now: NOW });
    const run = buildWeekView(
      week({ sessions: [session({ type: "run", lift: null, run: runDetails() })] }),
      { now: NOW },
    );

    expect(open.days[2].untimed[0].startable).toBe(true);
    expect(done.days[2].untimed[0].startable).toBe(false);
    expect(run.days[2].untimed[0].startable).toBe(false);
  });

  it("lanes two sessions at the same hour side by side", () => {
    const view = buildWeekView(
      week({
        sessions: [
          session({ id: "a", startMin: 17 * 60, durationMin: 60 }),
          session({ id: "b", startMin: 17 * 60 + 30, durationMin: 60 }),
        ],
      }),
      { now: NOW },
    );
    const timed = view.days.find((d) => d.date === "2026-09-16")!.timed;
    expect(timed.map((t) => t.lane).sort()).toEqual([0, 1]);
    expect(timed.every((t) => t.lanes === 2)).toBe(true);
  });

  it("renders a session whose detail row is missing rather than throwing", () => {
    // sessions.type is authoritative; a row with no details still has a date
    // and a status worth drawing.
    const view = buildWeekView(week({ sessions: [session({ lift: null })] }), { now: NOW });
    const card = view.days.find((d) => d.date === "2026-09-16")!.untimed[0];
    expect(card.title).toBe("Lift");
    expect(card.subtitle).toBeNull();
  });

  it("draws no warnings when there are no conflicts", () => {
    const view = buildWeekView(week({ sessions: [session()] }), { now: NOW });
    expect(view.warnings).toEqual([]);
    expect(view.days.find((d) => d.date === "2026-09-16")!.untimed[0].conflicts).toEqual([]);
  });

  it("puts a conflict on its card and in the week summary, and drops ones from outside the week", () => {
    const view = buildWeekView(week({ sessions: [session()] }), {
      now: NOW,
      conflicts: [
        { key: "a", ruleId: "r", message: "Too close", sessionIds: ["s1", "last-week"] },
        { key: "b", ruleId: "r", message: "Not this week", sessionIds: ["last-week"] },
      ],
    });
    expect(view.warnings).toEqual(["Too close"]);
    expect(view.days.find((d) => d.date === "2026-09-16")!.untimed[0].conflicts).toEqual(["Too close"]);
  });
});

function runDetails(over: Partial<NonNullable<CalendarSession["run"]>> = {}) {
  return {
    run_type: "easy" as const,
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
    ...over,
  };
}
