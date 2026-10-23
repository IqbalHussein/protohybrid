import type { RunDetails } from "./types";

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

export type RunNumbers = {
  distanceKm: number | null;
  durationSec: number | null;
  paceSecPerKm: number | null;
};

/** Which measure a run was planned by: the one both sides are described in. */
type Lead = "distance" | "duration";

function leadOf(run: RunNumbers): Lead | null {
  if (run.distanceKm != null) return "distance";
  if (run.durationSec != null && run.durationSec > 0) return "duration";
  return null;
}

/**
 * One side of a run in a few words: "10 km @ 5:00 /km", "45m @ 5:30 /km",
 * "10 km". Pace stands in for the third number, since any two give it.
 * `lead` is the measure the plan was set in, so the actual is described the
 * same way and the two read side by side; a side without it uses what it has.
 */
export function describeRun(run: RunNumbers, lead: Lead | null = leadOf(run)): string | null {
  const distance = formatDistance(run.distanceKm);
  const duration = formatRunDuration(run.durationSec);
  const pace = formatPace(run.paceSecPerKm ?? paceFrom(run.distanceKm, run.durationSec));

  const first = lead === "duration" ? duration ?? distance : distance ?? duration;
  if (!first) return pace ? `${pace} pace` : null;
  return pace ? `${first} @ ${pace}` : first;
}

export function runTargets(run: RunDetails): RunNumbers {
  return {
    distanceKm: run.target_distance_km,
    durationSec: run.target_duration_sec,
    paceSecPerKm: run.target_pace_sec_per_km,
  };
}

export function runActuals(run: RunDetails): RunNumbers {
  return {
    distanceKm: run.actual_distance_km,
    durationSec: run.actual_duration_sec,
    paceSecPerKm: run.actual_pace_sec_per_km,
  };
}

export type RunComparison = {
  /** "Planned 10 km @ 5:00 /km" */
  planned: string;
  /** "Ran 9.4 km @ 5:12 /km", or "Completed" when nothing was recorded. */
  ran: string;
};

/**
 * A completed run's plan and result, described in the same terms. Null when
 * there was no plan to compare with (an unplanned Strava run), so the caller
 * shows the actuals on their own.
 */
export function compareRun(run: RunDetails): RunComparison | null {
  const target = runTargets(run);
  const lead = leadOf(target);
  const planned = describeRun(target, lead);
  if (!planned) return null;
  const ran = describeRun(runActuals(run), lead);
  return { planned: `Planned ${planned}`, ran: ran ? `Ran ${ran}` : "Completed" };
}

/** "Planned 10 km @ 5:00 /km · Ran 9.4 km @ 5:12 /km", or null without a plan. */
export function plannedVsRan(run: RunDetails): string | null {
  const comparison = compareRun(run);
  return comparison ? `${comparison.planned} · ${comparison.ran}` : null;
}

/**
 * How the run differed from the plan, only on the measures both sides have:
 * "0.6 km short · 0:12 /km slower". Empty when it went to plan, and null when
 * no measure is on both sides to compare. Differences under 0.05 km, a minute
 * or 3 s/km are noise from GPS and rounding, and read as on target.
 */
export function runDifferences(run: RunDetails): string[] | null {
  const target = runTargets(run);
  const actual = runActuals(run);
  const out: string[] = [];
  let compared = false;

  if (target.distanceKm != null && actual.distanceKm != null) {
    compared = true;
    const diff = actual.distanceKm - target.distanceKm;
    if (Math.abs(diff) >= 0.05) out.push(`${formatDistance(Math.abs(diff))} ${diff < 0 ? "short" : "over"}`);
  } else if (target.durationSec && actual.durationSec) {
    compared = true;
    const diff = actual.durationSec - target.durationSec;
    if (Math.abs(diff) >= 60) out.push(`${formatRunDuration(Math.abs(diff))} ${diff < 0 ? "shorter" : "longer"}`);
  }

  const targetPace = target.paceSecPerKm;
  const actualPace = actual.paceSecPerKm ?? paceFrom(actual.distanceKm, actual.durationSec);
  if (targetPace && actualPace) {
    compared = true;
    const diff = actualPace - targetPace;
    if (Math.abs(diff) >= 3) out.push(`${formatPace(Math.abs(diff))} ${diff < 0 ? "faster" : "slower"}`);
  }

  return compared ? out : null;
}
