/**
 * The app's one source of truth for "what time is it, locally".
 *
 * `busy_blocks` are timestamptz; `sessions.planned_start_time` is a zone-less
 * `time`. Placing them on the same grid — and every conflict rule that comes
 * later — needs a fixed zone to compare them in. v1 is single-user, so that
 * zone is a constant here rather than a column. Phase 2 swaps this for a user
 * preference in one place instead of hunting down scattered `new Date()`.
 */
export const APP_TIME_ZONE = "America/Toronto";

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** An instant broken into local wall-clock components. */
export function zonedParts(instant: Date): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of PARTS.formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // en-CA renders midnight as hour 24; the rest of the app counts from 0.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** The local calendar date of an instant, as YYYY-MM-DD. */
export function zonedDateString(instant: Date): string {
  const { year, month, day } = zonedParts(instant);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Minutes since local midnight — the grid's vertical coordinate. */
export function minutesIntoDay(instant: Date): number {
  const { hour, minute } = zonedParts(instant);
  return hour * 60 + minute;
}

/** Today's local date. Every "what day is it" question routes through here. */
export function todayInZone(now: Date = new Date()): string {
  return zonedDateString(now);
}

/**
 * Turn a local date and time into the instant it names.
 *
 * The zone's offset depends on the instant, and the instant is what we're
 * solving for, so this guesses with the offset at the naive timestamp and then
 * corrects once using the offset actually in force there. One correction is
 * enough for every real zone: a second pass only ever matters for times that
 * do not exist (the spring-forward gap), which resolve to the hour after the
 * jump either way.
 */
export function zonedToUtc(dateString: string, timeString = "00:00"): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  const [hour, minute] = timeString.split(":").map(Number);

  const naive = Date.UTC(year, month - 1, day, hour || 0, minute || 0);
  const corrected = naive - offsetAt(new Date(naive));
  return new Date(naive - offsetAt(new Date(corrected)));
}

/** How far ahead of UTC the zone is, in ms, at a given instant. */
function offsetAt(instant: Date): number {
  const p = zonedParts(instant);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Seconds are the finest granularity formatToParts gives; drop the rest so a
  // sub-second remainder can't shift the result.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** "HH:MM" as stored in a `time` column, from minutes since midnight. */
export function minutesToTimeString(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Minutes since midnight from a `time` value, which Postgres returns as HH:MM:SS. */
export function timeStringToMinutes(time: string | null): number | null {
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

/** Display form for a time of day: "6:30 am", "12:05 pm". */
export function formatTimeOfDay(minutes: number): string {
  const m = ((Math.round(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour24 = Math.floor(m / 60);
  const suffix = hour24 < 12 ? "am" : "pm";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${pad(m % 60)} ${suffix}`;
}

/** Display form for a span, e.g. 90 -> "1h 30m". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Value for a datetime-local input, in local wall-clock terms. */
export function toDateTimeLocalValue(instant: Date): string {
  const p = zonedParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
