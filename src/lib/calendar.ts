import { requireUser, getSetsForSessions } from "@/lib/lift/queries";
import { getConflictRules, getSettings } from "@/lib/settings";
import {
  conflictWindow,
  evaluateConflicts,
  lookbackDays,
  type BusyBlock,
  type CalendarSession,
  type Conflict,
  type RunType,
} from "@/lib/conflicts";
import { addDays, shortTime, zonedToUtc, type DateString } from "@/lib/dates";
import { countsAsWork, setVolume } from "@/lib/lift/math";
import { formatKm } from "@/lib/format";

export type RunDetails = {
  run_type: RunType;
  target_distance_km: number | null;
  target_pace_sec_per_km: number | null;
  target_duration_sec: number | null;
  actual_distance_km: number | null;
  actual_pace_sec_per_km: number | null;
  actual_duration_sec: number | null;
  actual_avg_hr: number | null;
  actual_elevation_m: number | null;
  actual_started_at: string | null;
  strava_activity_id: string | null;
  strava_name: string | null;
};

export type LiftDetails = {
  focus: string;
  notes: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export type SessionRow = {
  id: string;
  type: "run" | "lift";
  planned_date: DateString;
  planned_time: string | null;
  status: "planned" | "completed" | "skipped";
  ad_hoc: boolean;
  notes: string | null;
  routine_id: string | null;
  routines: { name: string } | null;
  run_details: RunDetails | null;
  lift_details: LiftDetails | null;
};

export const SESSION_SELECT =
  "id, type, planned_date, planned_time, status, ad_hoc, notes, routine_id, routines(name), run_details(*), lift_details(focus, notes, started_at, completed_at)";

// PostgREST returns one-to-one embeds as an object, but the generated-less
// client can't know that; normalize either shape.
function one<T>(v: T | T[] | null | undefined): T | null {
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

export function normalizeSession(row: Record<string, unknown>): SessionRow {
  return {
    ...(row as unknown as SessionRow),
    routines: one(row.routines as SessionRow["routines"]),
    run_details: one(row.run_details as RunDetails),
    lift_details: one(row.lift_details as LiftDetails),
  };
}

export async function getSessionsBetween(from: DateString, to: DateString): Promise<SessionRow[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("sessions")
    .select(SESSION_SELECT)
    .gte("planned_date", from)
    .lte("planned_date", to)
    .order("planned_date")
    .order("planned_time", { nullsFirst: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(normalizeSession);
}

export async function getSession(id: string): Promise<SessionRow | null> {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("sessions").select(SESSION_SELECT).eq("id", id).maybeSingle();
  return data ? normalizeSession(data) : null;
}

export function sessionLabel(s: SessionRow): string {
  if (s.type === "run") {
    const d = s.run_details;
    const kind = d ? `${d.run_type[0].toUpperCase()}${d.run_type.slice(1)} run` : "Run";
    const km = d?.target_distance_km ?? d?.actual_distance_km;
    return km != null ? `${kind} ${formatKm(km)}` : kind;
  }
  const focus = s.lift_details?.focus ?? s.routines?.name ?? "Lift";
  return `${focus[0].toUpperCase()}${focus.slice(1)} lift`;
}

export function plannedMinutes(s: SessionRow): number | null {
  const d = s.run_details;
  if (!d) return null;
  if (d.target_duration_sec) return Math.round(d.target_duration_sec / 60);
  if (d.target_distance_km && d.target_pace_sec_per_km) {
    return Math.round((Number(d.target_distance_km) * d.target_pace_sec_per_km) / 60);
  }
  return null;
}

export function toCalendarSession(s: SessionRow): CalendarSession {
  return {
    id: s.id,
    type: s.type,
    date: s.planned_date,
    time: shortTime(s.planned_time),
    status: s.status,
    adHoc: s.ad_hoc,
    runType: s.run_details?.run_type ?? null,
    focus: s.type === "lift" ? s.lift_details?.focus ?? s.routines?.name ?? null : null,
    durationMinutes: plannedMinutes(s),
    label: sessionLabel(s),
  };
}

export type BusyRow = { id: string; title: string; start_time: string; end_time: string; source: "manual" | "google_calendar" };

export async function getBusyBlocksBetween(from: DateString, to: DateString, tz: string): Promise<BusyRow[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("busy_blocks")
    .select("id, title, start_time, end_time, source")
    .lt("start_time", zonedToUtc(addDays(to, 1), "00:00", tz).toISOString())
    .gt("end_time", zonedToUtc(from, "00:00", tz).toISOString())
    .order("start_time");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export const toBusyBlock = (b: BusyRow): BusyBlock => ({ id: b.id, title: b.title, start: b.start_time, end: b.end_time });

// Actual lift work per session, for planned-vs-actual on the calendar.
export async function getLiftActuals(sessionIds: string[]) {
  const sets = await getSetsForSessions(sessionIds);
  const out = new Map<string, { exercises: number; workingSets: number; volume: number }>();
  for (const [id, exercises] of sets) {
    const work = exercises.flatMap((e) => e.sets).filter((s) => countsAsWork(s.set_type));
    out.set(id, {
      exercises: exercises.length,
      workingSets: work.length,
      volume: work.reduce((sum, s) => sum + setVolume(s.weight, s.reps), 0),
    });
  }
  return out;
}

// Everything the week view needs: the week's sessions and busy blocks, plus
// conflicts evaluated over a padded window so rules that look back (rest-day
// streaks, "within 24h") see sessions just outside the week.
export async function getWeek(monday: DateString) {
  const [settings, rules] = await Promise.all([getSettings(), getConflictRules()]);
  const tz = settings.timezone;
  const window = conflictWindow(monday, rules);
  const sunday = addDays(monday, 6);

  const [sessions, busy] = await Promise.all([
    getSessionsBetween(window.from, window.to),
    getBusyBlocksBetween(window.from, window.to, tz),
  ]);

  const conflicts = evaluateConflicts(sessions.map(toCalendarSession), busy.map(toBusyBlock), rules, tz);
  const weekSessions = sessions.filter((s) => s.planned_date >= monday && s.planned_date <= sunday);
  const weekIds = new Set(weekSessions.map((s) => s.id));
  const weekConflicts = conflicts.filter(
    (c) => (c.date >= monday && c.date <= sunday) || c.sessionIds.some((id) => weekIds.has(id)),
  );

  const weekStartUtc = zonedToUtc(monday, "00:00", tz).getTime();
  const weekEndUtc = zonedToUtc(addDays(monday, 7), "00:00", tz).getTime();
  const weekBusy = busy.filter(
    (b) => new Date(b.start_time).getTime() < weekEndUtc && new Date(b.end_time).getTime() > weekStartUtc,
  );

  const liftActuals = await getLiftActuals(
    weekSessions.filter((s) => s.type === "lift" && s.status === "completed").map((s) => s.id),
  );

  return { tz, sessions: weekSessions, busy: weekBusy, conflicts: weekConflicts, liftActuals };
}

// Conflicts touching one session, for its detail page.
export async function getSessionConflicts(session: SessionRow): Promise<Conflict[]> {
  const [settings, rules] = await Promise.all([getSettings(), getConflictRules()]);
  const pad = lookbackDays(rules);
  const from = addDays(session.planned_date, -pad);
  const to = addDays(session.planned_date, pad);
  const [sessions, busy] = await Promise.all([
    getSessionsBetween(from, to),
    getBusyBlocksBetween(session.planned_date, session.planned_date, settings.timezone),
  ]);
  return evaluateConflicts(
    sessions.map(toCalendarSession),
    busy.map(toBusyBlock),
    rules,
    settings.timezone,
  ).filter((c) => c.sessionIds.includes(session.id));
}
