// Date helpers that work on "YYYY-MM-DD" strings and IANA timezones without a
// date library. The server runs in UTC, but "today", a session's planned_time,
// and which day a busy block lands on are all the user's wall-clock time
// (user_settings.timezone), so nothing here uses the process's local time.

export type DateString = string; // YYYY-MM-DD

const DAY_MS = 86_400_000;

function parse(date: DateString): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function format(ms: number): DateString {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parse(s));
}

export function addDays(date: DateString, n: number): DateString {
  return format(parse(date) + n * DAY_MS);
}

export function daysBetween(a: DateString, b: DateString): number {
  return Math.round((parse(b) - parse(a)) / DAY_MS);
}

// Plans are keyed by week_start_date with a unique (user_id, week_start_date)
// constraint, so every session must resolve to exactly one Monday.
export function mondayOf(date: DateString): DateString {
  const day = new Date(parse(date)).getUTCDay(); // 0 = Sunday
  return addDays(date, day === 0 ? -6 : 1 - day);
}

export function weekDates(monday: DateString): DateString[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Wall-clock date and time of an instant in `tz`.
export function zonedParts(instant: Date, tz: string): { date: DateString; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

export function todayIn(tz: string): DateString {
  return zonedParts(new Date(), tz).date;
}

function offsetMs(instant: Date, tz: string): number {
  const { date, time } = zonedParts(instant, tz);
  const [h, m] = time.split(":").map(Number);
  const asUtc = parse(date) + (h * 60 + m) * 60_000;
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

// The instant at which the wall clock in `tz` reads `date time`. Two passes
// settle the offset across DST transitions.
export function zonedToUtc(date: DateString, time: string, tz: string): Date {
  const [h, m] = time.split(":").map(Number);
  const wall = parse(date) + (h * 60 + m) * 60_000;
  let guess = wall - offsetMs(new Date(wall), tz);
  guess = wall - offsetMs(new Date(guess), tz);
  return new Date(guess);
}

// "07:30:00" (Postgres time) → "07:30"
export function shortTime(time: string | null): string | null {
  return time ? time.slice(0, 5) : null;
}

export function formatDate(date: DateString, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(parse(date)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...opts,
  });
}

export function formatTimeIn(iso: string, tz: string): string {
  return zonedParts(new Date(iso), tz).time;
}
