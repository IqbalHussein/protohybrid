import { requireUser } from "@/lib/auth";
import { timeStringToMinutes, zonedToUtc } from "@/lib/time";
import { addDays, weekDates } from "@/lib/week";
import type { BusyBlock, CalendarSession, LiftDetails, RunDetails, Week } from "./types";

const SESSION_COLUMNS =
  "id, type, status, planned_date, planned_start_time, planned_duration_min, routine_id, ad_hoc";

const RUN_COLUMNS =
  "run_type, target_distance_km, target_pace_sec_per_km, target_duration_sec, actual_distance_km, actual_pace_sec_per_km, actual_duration_sec, strava_activity_id, actual_avg_hr, actual_elevation_m, strava_name";

const LIFT_COLUMNS = "focus, notes, started_at, completed_at";

/** PostgREST types a to-one embed as an array; collapse it. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * `sessions.type` decides which detail row is authoritative.
 *
 * Nothing in 0001 stopped a session having both detail rows or neither; 0006
 * adds triggers that now prevent it, but rows written before that, or by a
 * future importer, still have to render rather than throw. So type wins: a
 * lift session ignores any run_details it somehow carries, and a session whose
 * own detail row is missing still draws as a card with its date and status.
 */
function toSession(row: Record<string, unknown>): CalendarSession {
  const type = row.type as CalendarSession["type"];
  return {
    id: row.id as string,
    type,
    status: row.status as CalendarSession["status"],
    plannedDate: row.planned_date as string,
    startMin: timeStringToMinutes(row.planned_start_time as string | null),
    durationMin: (row.planned_duration_min as number | null) ?? null,
    routineId: (row.routine_id as string | null) ?? null,
    adHoc: Boolean(row.ad_hoc),
    run: type === "run" ? one(row.run_details as RunDetails | RunDetails[] | null) : null,
    lift: type === "lift" ? one(row.lift_details as LiftDetails | LiftDetails[] | null) : null,
  };
}

/**
 * Everything the week grid draws.
 *
 * Reads only: browsing six weeks forward must leave no `plans` rows behind, so
 * a week with no plan simply comes back empty. Sessions are fetched through
 * `plans` by week rather than by `plan_id`, so a session whose date has been
 * moved is found by the week it is actually in.
 */
export async function getWeek(weekStart: string): Promise<Week> {
  const { supabase, user } = await requireUser();
  const dates = weekDates(weekStart);
  const weekEnd = addDays(weekStart, 7);

  const [{ data: sessions }, { data: blocks }] = await Promise.all([
    supabase
      .from("sessions")
      .select(`${SESSION_COLUMNS}, run_details(${RUN_COLUMNS}), lift_details(${LIFT_COLUMNS})`)
      .gte("planned_date", weekStart)
      .lt("planned_date", weekEnd)
      .order("planned_date")
      .order("planned_start_time", { nullsFirst: true }),

    // Blocks are timestamptz, so the week's bounds are converted through the
    // app's zone. Anything overlapping the week counts, however early it
    // started — a block from Friday to Tuesday still covers Monday.
    supabase
      .from("busy_blocks")
      .select("id, title, start_time, end_time, source")
      .eq("user_id", user.id)
      .lt("start_time", zonedToUtc(weekEnd).toISOString())
      .gt("end_time", zonedToUtc(weekStart).toISOString())
      .order("start_time"),
  ]);

  return {
    weekStart,
    dates,
    sessions: (sessions ?? []).map((s) => toSession(s as Record<string, unknown>)),
    busyBlocks: (blocks ?? []).map((b) => ({
      id: b.id as string,
      title: b.title as string,
      startTime: b.start_time as string,
      endTime: b.end_time as string,
      source: b.source as BusyBlock["source"],
    })),
  };
}

/**
 * Sessions dated in [from, to), for conflict checks that reach past the
 * week's edges. Read-only, like the grid.
 */
export async function getSessionsBetween(from: string, to: string): Promise<CalendarSession[]> {
  const { supabase } = await requireUser();

  const { data } = await supabase
    .from("sessions")
    .select(`${SESSION_COLUMNS}, run_details(${RUN_COLUMNS}), lift_details(${LIFT_COLUMNS})`)
    .gte("planned_date", from)
    .lt("planned_date", to)
    .order("planned_date");

  return (data ?? []).map((s) => toSession(s as Record<string, unknown>));
}

export async function getSession(sessionId: string): Promise<CalendarSession | null> {
  const { supabase } = await requireUser();

  const { data } = await supabase
    .from("sessions")
    .select(`${SESSION_COLUMNS}, run_details(${RUN_COLUMNS}), lift_details(${LIFT_COLUMNS})`)
    .eq("id", sessionId)
    .maybeSingle();

  return data ? toSession(data as Record<string, unknown>) : null;
}

export async function getBusyBlock(blockId: string): Promise<BusyBlock | null> {
  const { supabase } = await requireUser();

  const { data } = await supabase
    .from("busy_blocks")
    .select("id, title, start_time, end_time, source")
    .eq("id", blockId)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id as string,
    title: data.title as string,
    startTime: data.start_time as string,
    endTime: data.end_time as string,
    source: data.source as BusyBlock["source"],
  };
}

/** How many sets a completed lift logged, for its card's subtitle. */
export async function getLoggedSetCounts(sessionIds: string[]): Promise<Map<string, number>> {
  if (!sessionIds.length) return new Map();
  const { supabase } = await requireUser();

  const { data } = await supabase
    .from("lift_sets")
    .select("lift_details_id")
    .in("lift_details_id", sessionIds);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = row.lift_details_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Routine names for the lift session editor's "pull target exercises from" picker. */
export async function getRoutineOptions(): Promise<{ id: string; name: string }[]> {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("routines").select("id, name").order("name");
  return (data ?? []) as { id: string; name: string }[];
}
