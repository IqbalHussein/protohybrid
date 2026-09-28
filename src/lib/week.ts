import { todayInZone, zonedDateString } from "./time";

/**
 * Week math, shared by the lift logger and the weekly calendar.
 *
 * Lived in `src/lib/lift/week.ts` until the calendar needed it too; the
 * calendar spec called the move out once the logger work had landed.
 *
 * Dates are handled as YYYY-MM-DD strings rather than Date objects wherever
 * possible. `planned_date` is a Postgres `date`, and a string never picks up a
 * zone on the way through the runtime the way a Date silently does.
 */

export const DAYS_IN_WEEK = 7;

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// Plans are keyed by week_start_date with a unique (user_id, week_start_date)
// constraint, so every session must resolve to exactly one Monday.
export function mondayOf(date: Date | string): string {
  const d = typeof date === "string" ? parseDateString(date) : new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toDateString(d);
}

export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The Monday of the week containing today, in the app's zone. */
export function currentWeekStart(now: Date = new Date()): string {
  return mondayOf(zonedDateString(now));
}

/**
 * A YYYY-MM-DD string as a Date at local midnight.
 *
 * `new Date("2026-09-18")` parses as UTC midnight, which is the previous day
 * in every western zone — the classic off-by-one that makes a calendar render
 * Sunday's sessions on Saturday. The explicit constructor avoids it.
 */
export function parseDateString(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date: string, days: number): string {
  const d = parseDateString(date);
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  // Rounded because a DST change makes one "day" 23 or 25 hours long.
  return Math.round((parseDateString(b).getTime() - parseDateString(a).getTime()) / 86_400_000);
}

export function addWeeks(date: string, weeks: number): string {
  return addDays(date, weeks * DAYS_IN_WEEK);
}

/** The seven dates of a week, Monday first. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDays(weekStart, i));
}

/** Whether a date falls inside the week beginning on `weekStart`. */
export function isInWeek(date: string, weekStart: string): boolean {
  return date >= weekStart && date < addDays(weekStart, DAYS_IN_WEEK);
}

export function isToday(date: string, now: Date = new Date()): boolean {
  return date === todayInZone(now);
}

export function isPast(date: string, now: Date = new Date()): boolean {
  return date < todayInZone(now);
}

/** "Mon 18" — the column headings. */
export function formatDayHeading(date: string): string {
  const d = parseDateString(date);
  return `${DAY_NAMES[(d.getDay() + 6) % 7]} ${d.getDate()}`;
}

/** "Sep 15 – 21, 2026" — the week navigator's label, collapsing a shared month. */
export function formatWeekRange(weekStart: string): string {
  const start = parseDateString(weekStart);
  const end = parseDateString(addDays(weekStart, DAYS_IN_WEEK - 1));
  const month = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });

  const tail =
    start.getMonth() === end.getMonth()
      ? `${end.getDate()}`
      : `${month(end)} ${end.getDate()}`;

  return `${month(start)} ${start.getDate()} – ${tail}, ${end.getFullYear()}`;
}
