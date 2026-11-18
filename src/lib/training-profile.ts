import type { GeneratedBlock, TrainingProfile, Weekday } from "@/lib/planner";
import { addDays, weekStart } from "@/lib/time";
import type { AcceptBlockSession, TrainingProfileRow } from "@/lib/types";

// Conversions between the planner's TrainingProfile / GeneratedBlock and the
// database shapes (training_profiles row, accept_training_block payload).

export function profileFromRow(row: TrainingProfileRow): TrainingProfile {
  const byWeekday: Partial<Record<Weekday, number>> = {};
  for (const [k, v] of Object.entries(row.minutes_by_weekday ?? {})) byWeekday[Number(k) as Weekday] = Number(v);
  const goal: TrainingProfile["goal"] =
    row.goal_type === "race" && row.race_distance_km != null && row.race_date
      ? { type: "race", distanceKm: Number(row.race_distance_km), date: row.race_date }
      : row.goal_type === "strength"
        ? { type: "strength" }
        : { type: "none" };
  return {
    preset: row.preset,
    weights: { strength: row.w_strength, hypertrophy: row.w_hypertrophy, endurance: row.w_endurance },
    daysPerWeek: row.days_per_week,
    minutesPerDay: row.minutes_per_day,
    minutesByWeekday: Object.keys(byWeekday).length ? byWeekday : undefined,
    restDays: [...(row.rest_days ?? [])].sort((a, b) => a - b) as Weekday[],
    goal,
    experience: row.experience,
  };
}

export function profileToRow(userId: string, p: TrainingProfile): Omit<TrainingProfileRow, "created_at" | "updated_at"> {
  const byWeekday: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.minutesByWeekday ?? {})) if (v !== undefined) byWeekday[k] = v;
  return {
    user_id: userId,
    preset: p.preset,
    w_strength: p.weights.strength,
    w_hypertrophy: p.weights.hypertrophy,
    w_endurance: p.weights.endurance,
    days_per_week: p.daysPerWeek,
    minutes_per_day: p.minutesPerDay,
    minutes_by_weekday: byWeekday,
    rest_days: [...p.restDays],
    goal_type: p.goal.type,
    race_distance_km: p.goal.type === "race" ? p.goal.distanceKm : null,
    race_date: p.goal.type === "race" ? p.goal.date : null,
    experience: p.experience,
  };
}

// Flattens a block into accept_training_block's p_sessions. Sessions dated
// before fromDate (when given) are dropped.
export function toAcceptSessions(block: GeneratedBlock, fromDate?: string): AcceptBlockSession[] {
  const out: AcceptBlockSession[] = [];
  for (const week of block.weeks) {
    for (const s of week.sessions) {
      if (fromDate && s.date < fromDate) continue;
      out.push({
        date: s.date,
        type: s.type,
        run_type: s.type === "run" ? s.runType : null,
        focus: s.type === "lift" ? s.liftFocus : null,
        duration_min: s.durationMin,
        intensity: s.intensity,
        rationale: s.rationale,
        prescription: { ...s.prescription, slot: s.slot, key: s.key, week: s.week },
      });
    }
  }
  return out;
}

// Monday of today's week ("this") or of the following week ("next").
export function blockStartFor(today: string, choice: "this" | "next"): string {
  const monday = weekStart(today);
  return choice === "this" ? monday : addDays(monday, 7);
}
