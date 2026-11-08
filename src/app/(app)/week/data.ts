import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConflictBusy, ConflictSession } from "@/lib/conflicts";
import { addDays, formatTime, parseTime, zonedParts, zonedToUtc } from "@/lib/time";
import { ensureDefaultConflictRules } from "@/lib/settings";
import type { BusyBlock, ConflictRule, LiftDetails, RunDetails, RunType, Session } from "@/lib/types";

// Serializable shapes passed from the server page to client components.

export type CardRun = {
  runType: RunType;
  targetDistanceKm: number | null;
  targetDurationSec: number | null;
  targetPaceSec: number | null;
  actualDistanceKm: number | null;
  actualDurationSec: number | null;
  actualPaceSec: number | null;
  avgHr: number | null;
  elevationM: number | null;
  notes: string | null;
};

export type CardLift = {
  focus: string;
  routineName: string | null;
  notes: string | null;
  setCount: number;
};

export type CardSession = {
  id: string;
  type: Session["type"];
  status: Session["status"];
  date: string;
  startTime: string | null; // "HH:MM"
  durationMin: number | null; // planned, or actual for completed runs
  run: CardRun | null;
  lift: CardLift | null;
  conflicts: string[]; // messages
};

export type DayBusy = { id: string; title: string; startMin: number; endMin: number; source: BusyBlock["source"] };

type SessionRow = Pick<
  Session,
  "id" | "type" | "status" | "planned_date" | "planned_start_time" | "planned_duration_min" | "created_at"
> & {
  run_details: Omit<RunDetails, "session_id"> | null;
  lift_details: (Pick<LiftDetails, "focus" | "notes"> & { lift_sets: { id: string }[] }) | null;
  routines: { name: string } | null;
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function loadSessions(supabase: SupabaseClient, from: string, to: string) {
  const { data, error } = await supabase
    .from("sessions")
    .select(
      "id, type, status, planned_date, planned_start_time, planned_duration_min, created_at, run_details(*), lift_details(focus, notes, lift_sets(id)), routines(name)",
    )
    .gte("planned_date", from)
    .lte("planned_date", to)
    .order("planned_date")
    .order("planned_start_time", { nullsFirst: false })
    .order("created_at")
    .returns<SessionRow[]>();
  if (error) return { error: error.message, sessions: [] as CardSession[] };

  const sessions: CardSession[] = (data ?? []).map((row) => {
    const r = row.run_details;
    const l = row.lift_details;
    const startMin = parseTime(row.planned_start_time);
    const actualDuration = num(r?.actual_duration_sec);
    const targetDuration = num(r?.target_duration_sec);
    let durationMin = row.planned_duration_min;
    if (row.type === "run") {
      if (row.status === "completed" && actualDuration) durationMin = Math.ceil(actualDuration / 60);
      else if (durationMin == null && targetDuration) durationMin = Math.ceil(targetDuration / 60);
    }
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      date: row.planned_date,
      startTime: startMin === null ? null : formatTime(startMin),
      durationMin: durationMin ?? null,
      run: r
        ? {
            runType: r.run_type,
            targetDistanceKm: num(r.target_distance_km),
            targetDurationSec: targetDuration,
            targetPaceSec: num(r.target_pace_sec_per_km),
            actualDistanceKm: num(r.actual_distance_km),
            actualDurationSec: actualDuration,
            actualPaceSec: num(r.actual_pace_sec_per_km),
            avgHr: num(r.actual_avg_hr),
            elevationM: num(r.actual_elevation_m),
            notes: r.notes,
          }
        : null,
      lift: l
        ? {
            focus: l.focus,
            routineName: row.routines?.name ?? null,
            notes: l.notes,
            setCount: l.lift_sets?.length ?? 0,
          }
        : null,
      conflicts: [],
    };
  });
  return { error: null, sessions };
}

export function toConflictSession(s: CardSession): ConflictSession {
  return {
    id: s.id,
    type: s.type,
    status: s.status,
    date: s.date,
    startMin: parseTime(s.startTime),
    durationMin: s.durationMin,
    runType: s.run?.runType ?? null,
    liftFocus: s.lift?.focus ?? null,
  };
}

// Splits a busy block into per-local-day pieces (end exclusive, 1440 = midnight).
export function splitBusyBlock(block: Pick<BusyBlock, "id" | "title" | "start_time" | "end_time">, tz: string): ConflictBusy[] {
  const start = zonedParts(block.start_time, tz);
  const end = zonedParts(block.end_time, tz);
  const pieces: ConflictBusy[] = [];
  for (let d = start.date, guard = 0; d <= end.date && guard < 60; d = addDays(d, 1), guard++) {
    const startMin = d === start.date ? start.minutes : 0;
    const endMin = d === end.date ? end.minutes : 1440;
    if (endMin > startMin) pieces.push({ id: block.id, title: block.title, date: d, startMin, endMin });
  }
  return pieces;
}

export async function loadBusy(supabase: SupabaseClient, weekStart: string, tz: string) {
  const from = zonedToUtc(weekStart, "00:00", tz).toISOString();
  const to = zonedToUtc(addDays(weekStart, 7), "00:00", tz).toISOString();
  const { data, error } = await supabase
    .from("busy_blocks")
    .select("id, title, start_time, end_time, source")
    .lt("start_time", to)
    .gt("end_time", from)
    .order("start_time")
    .returns<Pick<BusyBlock, "id" | "title" | "start_time" | "end_time" | "source">[]>();
  if (error) return { error: error.message, pieces: [] as (ConflictBusy & { source: BusyBlock["source"] })[] };
  const pieces = (data ?? []).flatMap((b) => splitBusyBlock(b, tz).map((p) => ({ ...p, source: b.source })));
  return { error: null, pieces };
}

export async function loadRules(supabase: SupabaseClient) {
  const seedError = await ensureDefaultConflictRules(supabase);
  const { data, error } = await supabase
    .from("conflict_rules")
    .select("*")
    .eq("enabled", true)
    .order("created_at")
    .returns<ConflictRule[]>();
  return { error: seedError ?? error?.message ?? null, rules: data ?? [] };
}

export async function loadRoutines(supabase: SupabaseClient) {
  const { data } = await supabase.from("routines").select("id, name").order("name").returns<{ id: string; name: string }[]>();
  return data ?? [];
}
