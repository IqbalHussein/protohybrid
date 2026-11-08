// Date/time helpers. Calendar dates are plain "YYYY-MM-DD" strings and are
// manipulated with UTC arithmetic so they never shift with the host timezone.
// The user's IANA timezone comes from the `tz` cookie (set by
// components/timezone-sync.tsx); servers on Vercel run in UTC.

export const TZ_COOKIE = "tz";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export function isValidTimeZone(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(tz: string | undefined | null): string {
  return isValidTimeZone(tz) ? tz : "UTC";
}

export function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// "HH:MM" or "HH:MM:SS" -> minutes after midnight, or null.
export function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = TIME_RE.exec(value);
  return m ? +m[1] * 60 + +m[2] : null;
}

// minutes after midnight -> "HH:MM"
export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function toUtcMs(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromUtcMs(toUtcMs(date) + days * 86_400_000);
}

// Whole days from a to b (b - a).
export function diffDays(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86_400_000);
}

// 1 = Monday ... 7 = Sunday
export function isoWeekday(date: string): number {
  const d = new Date(toUtcMs(date)).getUTCDay();
  return d === 0 ? 7 : d;
}

// Monday of the week containing date.
export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// Today's date in the given timezone.
export function todayIn(tz: string, now: Date = new Date()): string {
  return zonedParts(now, tz).date;
}

// Local calendar date and minutes-after-midnight of an instant in tz.
export function zonedParts(instant: Date | string, tz: string): { date: string; minutes: number } {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: +get("hour") * 60 + +get("minute"),
  };
}

// Offset of tz from UTC at the given instant, in ms (local = utc + offset).
function tzOffsetMs(utcMs: number, tz: string): number {
  const { date, minutes } = zonedParts(new Date(utcMs), tz);
  const localAsUtc = toUtcMs(date) + minutes * 60_000;
  const truncated = utcMs - (utcMs % 60_000);
  return localAsUtc - truncated;
}

// Converts a wall-clock date + "HH:MM" in tz to a UTC Date. For times that
// don't exist (DST spring-forward gap) the result is shifted forward by the gap.
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const minutes = parseTime(time);
  if (minutes === null) throw new Error(`Invalid time: ${time}`);
  const wall = toUtcMs(date) + minutes * 60_000;
  const first = wall - tzOffsetMs(wall, tz);
  const second = wall - tzOffsetMs(first, tz);
  const roundTrips = (utc: number) => {
    const p = zonedParts(new Date(utc), tz);
    return p.date === date && p.minutes === minutes;
  };
  if (roundTrips(second)) return new Date(second);
  if (roundTrips(first)) return new Date(first);
  // Nonexistent local time: use the later candidate (just after the gap).
  return new Date(Math.max(first, second));
}

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function weekdayShort(date: string): string {
  return WEEKDAY_SHORT[isoWeekday(date) - 1];
}

// "3 Nov"
export function formatDayMonth(date: string): string {
  const m = DATE_RE.exec(date)!;
  return `${+m[3]} ${MONTH_SHORT[+m[2] - 1]}`;
}

// "Mon 3 Nov"
export function formatDateLabel(date: string): string {
  return `${weekdayShort(date)} ${formatDayMonth(date)}`;
}

// "3–9 Nov 2026" or "27 Oct – 2 Nov 2026"
export function formatWeekRange(start: string): string {
  const end = addDays(start, 6);
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sy !== ey) return `${sd} ${MONTH_SHORT[sm - 1]} ${sy} – ${ed} ${MONTH_SHORT[em - 1]} ${ey}`;
  if (sm !== em) return `${sd} ${MONTH_SHORT[sm - 1]} – ${ed} ${MONTH_SHORT[em - 1]} ${ey}`;
  return `${sd}–${ed} ${MONTH_SHORT[em - 1]} ${ey}`;
}
