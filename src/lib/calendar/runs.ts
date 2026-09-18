/**
 * Run numbers: pace, distance and duration, and the conversions between them.
 *
 * `run_details` stores pace as seconds per km and duration as seconds, but
 * nobody plans a run in those units — they type "5:30" and "45". Everything
 * that crosses that boundary lives here, so Strava sync later writes the same
 * columns through the same rules.
 */

/** Seconds per km from a distance and a duration, or null when either is missing. */
export function paceFrom(distanceKm: number | null, durationSec: number | null): number | null {
  if (!distanceKm || !durationSec || distanceKm <= 0 || durationSec <= 0) return null;
  return Math.round(durationSec / distanceKm);
}

/** "5:30" -> 330 seconds. Also accepts plain seconds ("330") and minutes ("5"). */
export function parsePace(input: string | null): number | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  if (raw.includes(":")) {
    const [minutes, seconds] = raw.split(":").map(Number);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    return Math.round(minutes * 60 + seconds);
  }

  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  // A bare number under 20 is minutes per km; above that it is already seconds.
  return Math.round(n < 20 ? n * 60 : n);
}

export function formatPace(secPerKm: number | null): string | null {
  if (!secPerKm || secPerKm <= 0) return null;
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} /km`;
}

export function formatDistance(km: number | null): string | null {
  if (km == null) return null;
  // Trailing zeros read as false precision on a planned distance.
  return `${Number(km.toFixed(2))} km`;
}

/** Seconds as a duration for display: "45m", "1h 12m". */
export function formatRunDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const m = minutes % 60;
  return m ? `${Math.floor(minutes / 60)}h ${m}m` : `${Math.floor(minutes / 60)}h`;
}

/** Minutes, as typed into a form, back to the seconds the column stores. */
export function minutesToSeconds(minutes: number | null): number | null {
  if (minutes == null || minutes <= 0) return null;
  return Math.round(minutes * 60);
}

export function secondsToMinutes(seconds: number | null): number | null {
  if (seconds == null || seconds <= 0) return null;
  return Math.round(seconds / 60);
}
