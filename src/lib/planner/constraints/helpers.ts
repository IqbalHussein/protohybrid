import { dayName } from "../model";
import type { DayLayout, LayoutSession, WeekLayout } from "./types";

export const AM_START = 7 * 60;
export const PM_START = 18 * 60;
const DAY = 24 * 60;
const WEEK = 7 * DAY;

// Single-session days start at 07:00; stacked days use the AM (07:00) and PM (18:00) slots.
export function startMinute(day: DayLayout, s: LayoutSession): number {
  if (day.sessions.length < 2) return AM_START;
  if (s.slot === "pm") return PM_START;
  if (s.slot === "am") return AM_START;
  return day.sessions.indexOf(s) === 0 ? AM_START : PM_START;
}

export const isHardRun = (s: LayoutSession) => s.type === "run" && (s.runType === "tempo" || s.runType === "interval");
export const isLongRun = (s: LayoutSession) => s.type === "run" && s.runType === "long";
export const isHardDay = (day: DayLayout) => day.sessions.some((s) => s.intensity === "hard");

export function runLabel(s: LayoutSession): string {
  if (s.runType === "tempo") return "tempo run";
  if (s.runType === "interval") return "interval run";
  if (s.runType === "long") return "long run";
  return "run";
}

export type LiftBeforeRun = { lift: LayoutSession; liftDay: DayLayout; run: LayoutSession; runDay: DayLayout };

// Heavy-leg lifts that end less than 24 h before a matching run starts (week is circular).
export function heavyLowerBeforeRun(layout: WeekLayout, wanted: (s: LayoutSession) => boolean): LiftBeforeRun[] {
  const out: LiftBeforeRun[] = [];
  layout.days.forEach((liftDay, li) => {
    for (const lift of liftDay.sessions) {
      if (lift.type !== "lift" || !lift.heavyLower) continue;
      const liftEnd = li * DAY + startMinute(liftDay, lift) + lift.durationMin;
      layout.days.forEach((runDay, ri) => {
        for (const run of runDay.sessions) {
          if (!wanted(run)) continue;
          const runStart = ri * DAY + startMinute(runDay, run);
          const gap = (((runStart - liftEnd) % WEEK) + WEEK) % WEEK;
          if (gap < DAY) out.push({ lift, liftDay, run, runDay });
        }
      });
    }
  });
  return out;
}

export function describeLiftRun(p: LiftBeforeRun): string {
  const same = p.liftDay === p.runDay;
  const when = same ? "the same day" : `${dayName(p.liftDay.weekday)}`;
  return `${dayName(p.runDay.weekday)}'s ${runLabel(p.run)} comes within 24 h of a heavy leg lift (${when})`;
}
