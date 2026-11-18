import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  GeneratedBlock,
  Intensity,
  LiftPrescription,
  PlannedRunType,
  RunPrescription,
  Slot,
  TrainingProfile,
  WeekKind,
} from "@/lib/planner";
import { addDays, diffDays, isoWeekday } from "@/lib/time";
import { profileFromRow } from "@/lib/training-profile";
import type { Session, SessionType, TrainingBlockRow, TrainingProfileRow } from "@/lib/types";

// Serializable shapes shared by the preview (a GeneratedBlock) and the active
// plan (rows in the database).

export type PlanSessionStatus = Session["status"] | "preview";

export type PlanSessionView = {
  id: string | null; // null in preview
  key: string;
  week: number; // 1-based
  date: string;
  weekday: number; // ISO 1..7
  slot: Slot;
  type: SessionType;
  runType: PlannedRunType | null;
  liftFocus: string | null;
  intensity: Intensity;
  durationMin: number;
  status: PlanSessionStatus;
  rationale: string;
  prescription: RunPrescription | LiftPrescription | null;
};

export type PlanWeekView = {
  index: number;
  kind: WeekKind;
  startDate: string;
  runMin: number;
  liftMin: number;
};

export type PlanView = { weeks: PlanWeekView[]; sessions: PlanSessionView[] };

const SLOTS = ["am", "pm"];

function asPrescription(value: unknown): RunPrescription | LiftPrescription | null {
  if (!value || typeof value !== "object") return null;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "run" || kind === "lift" ? (value as RunPrescription | LiftPrescription) : null;
}

export function viewFromGenerated(block: GeneratedBlock): PlanView {
  const sessions: PlanSessionView[] = [];
  for (const w of block.weeks)
    for (const s of w.sessions)
      sessions.push({
        id: null,
        key: s.key,
        week: s.week,
        date: s.date,
        weekday: s.weekday,
        slot: s.slot,
        type: s.type,
        runType: s.runType,
        liftFocus: s.liftFocus,
        intensity: s.intensity,
        durationMin: s.durationMin,
        status: "preview",
        rationale: s.rationale,
        prescription: s.prescription,
      });
  const weeks = block.weeks.map((w) => ({ index: w.index, kind: w.kind, startDate: w.startDate, runMin: 0, liftMin: 0 }));
  return { weeks: withTotals(weeks, sessions), sessions };
}

function withTotals(weeks: PlanWeekView[], sessions: PlanSessionView[]): PlanWeekView[] {
  return weeks.map((w) => {
    const mine = sessions.filter((s) => s.week === w.index);
    return {
      ...w,
      runMin: mine.filter((s) => s.type === "run").reduce((n, s) => n + s.durationMin, 0),
      liftMin: mine.filter((s) => s.type === "lift").reduce((n, s) => n + s.durationMin, 0),
    };
  });
}

// Week index of a date within a block, 1-based. Not clamped.
export function weekIndexOf(startDate: string, date: string): number {
  return Math.floor(diffDays(startDate, date) / 7) + 1;
}

type DbSessionRow = Pick<
  Session,
  "id" | "status" | "planned_date" | "planned_start_time" | "planned_duration_min" | "intensity" | "rationale" | "prescription"
> & {
  type: SessionType;
  run_details: { run_type: PlannedRunType; target_duration_sec: number | null } | null;
  lift_details: { focus: string; lift_sets: { id: string }[] } | null;
};

export function viewFromRows(block: Pick<TrainingBlockRow, "start_date" | "weeks">, rows: DbSessionRow[]): PlanView {
  const sessions: PlanSessionView[] = rows.map((r) => {
    const rx = asPrescription(r.prescription);
    const raw = (r.prescription ?? {}) as { slot?: unknown; key?: unknown };
    const targetMin = r.run_details?.target_duration_sec ? Math.ceil(r.run_details.target_duration_sec / 60) : 0;
    return {
      id: r.id,
      key: typeof raw.key === "string" ? raw.key : r.id,
      week: weekIndexOf(block.start_date, r.planned_date),
      date: r.planned_date,
      weekday: isoWeekday(r.planned_date),
      slot: typeof raw.slot === "string" && SLOTS.includes(raw.slot) ? (raw.slot as Slot) : null,
      type: r.type,
      runType: r.run_details?.run_type ?? null,
      liftFocus: r.lift_details?.focus ?? null,
      intensity: r.intensity ?? "moderate",
      durationMin: r.planned_duration_min ?? targetMin,
      status: r.status,
      rationale: r.rationale ?? "",
      prescription: rx,
    };
  });
  // The stored block has no week kinds; the last week of every 4 is the deload.
  const weeks: PlanWeekView[] = Array.from({ length: block.weeks }, (_, i) => ({
    index: i + 1,
    kind: (i + 1) % 4 === 0 ? ("deload" as const) : ("build" as const),
    startDate: addDays(block.start_date, i * 7),
    runMin: 0,
    liftMin: 0,
  }));
  return { weeks: withTotals(weeks, sessions), sessions };
}

export async function loadProfile(supabase: SupabaseClient, userId: string): Promise<TrainingProfile | null> {
  const { data, error } = await supabase
    .from("training_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle<TrainingProfileRow>();
  if (error) throw new Error(`Couldn't load your profile: ${error.message}`);
  return data ? profileFromRow(data) : null;
}

export async function loadActiveBlock(
  supabase: SupabaseClient,
): Promise<{ block: TrainingBlockRow; sessions: PlanSessionView[]; weeks: PlanWeekView[] } | null> {
  const { data: block, error } = await supabase
    .from("training_blocks")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<TrainingBlockRow>();
  if (error) throw new Error(`Couldn't load your plan: ${error.message}`);
  if (!block) return null;

  const { data, error: sessionsError } = await supabase
    .from("sessions")
    .select(
      "id, type, status, planned_date, planned_start_time, planned_duration_min, intensity, rationale, prescription, run_details(run_type, target_duration_sec), lift_details(focus, lift_sets(id))",
    )
    .eq("block_id", block.id)
    .order("planned_date")
    .order("planned_start_time", { nullsFirst: false })
    .order("created_at")
    .returns<DbSessionRow[]>();
  if (sessionsError) throw new Error(`Couldn't load your plan's sessions: ${sessionsError.message}`);

  const view = viewFromRows(block, data ?? []);
  return { block, sessions: view.sessions, weeks: view.weeks };
}
