// Row and RPC types mirroring the LIVE database schema
// (supabase/tests/live_schema.sql + migrations/0003_full_app.sql).
// Dates are "YYYY-MM-DD", times "HH:MM:SS", timestamps ISO strings.
// numeric columns arrive from PostgREST as numbers.

export type SessionType = "run" | "lift";
export type SessionStatus = "planned" | "completed" | "skipped";
export type RunType = "easy" | "tempo" | "long" | "interval" | "race";
export type SetType = "warmup" | "working" | "drop" | "failure";
export type WeightUnit = "lb" | "kg";
export type PrRecordType = "heaviest_weight" | "best_e1rm" | "most_reps" | "best_volume";
export type BusyBlockSource = "manual" | "google_calendar";

export const RUN_TYPES: readonly RunType[] = ["easy", "tempo", "long", "interval", "race"];
export const SET_TYPES: readonly SetType[] = ["warmup", "working", "drop", "failure"];
// Suggested lift focuses. lift_details.focus is free text, so older rows may
// hold other values; always render the raw value.
export const LIFT_FOCUSES = ["push", "pull", "legs", "upper", "lower", "full-body", "other"] as const;

export type Plan = {
  id: string;
  user_id: string;
  week_start_date: string;
  created_at: string;
};

export type Session = {
  id: string;
  plan_id: string;
  type: SessionType;
  planned_date: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
  routine_id: string | null;
  planned_start_time: string | null;
  planned_duration_min: number | null;
  ad_hoc: boolean;
};

export type RunDetails = {
  session_id: string;
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
  notes: string | null;
};

export type LiftDetails = {
  session_id: string;
  focus: string;
  notes: string | null;
  started_at: string | null;
  completed_at: string | null;
};

// weight is always stored in lb; convert with lib/units.ts.
export type LiftSet = {
  id: string;
  lift_details_id: string;
  exercise_id: string;
  set_number: number;
  set_type: SetType;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
  superset_group: string | null;
  created_at: string;
};

export type Exercise = {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  is_custom: boolean;
  user_id: string | null;
  created_at: string;
};

export type Routine = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
};

export type RoutineExercise = {
  id: string;
  routine_id: string;
  exercise_id: string;
  target_sets: number | null;
  target_reps: number | null;
  position: number;
};

// value is in lb for weight-based records, reps for most_reps.
export type PersonalRecord = {
  id: string;
  user_id: string;
  exercise_id: string;
  record_type: PrRecordType;
  value: number;
  weight: number | null;
  reps: number | null;
  session_id: string | null;
  achieved_at: string;
};

export type ExerciseRestPref = {
  user_id: string;
  exercise_id: string;
  rest_seconds: number; // 0..3600
  updated_at: string;
};

export type BusyBlock = {
  id: string;
  user_id: string;
  title: string;
  start_time: string;
  end_time: string;
  source: BusyBlockSource;
  google_event_id: string | null;
  created_at: string;
};

export type UserSettings = {
  user_id: string;
  conflict_rules_seeded: boolean;
  weight_unit: WeightUnit;
  updated_at: string;
};

export type OAuthConnection = {
  user_id: string;
  provider: "google";
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
  external_account_id: string | null;
  external_account_name: string | null;
  last_synced_at: string | null;
  created_at: string;
};

// ---- Conflict rules ------------------------------------------------------
// conflict_rules.rule_type is constrained to these four values in the DB.

export type MinHoursBetweenParams = {
  hours: number;
  // Optional filters on side A / B. Omitted or empty = any session of that type.
  a_run_types?: RunType[];
  a_lift_focus?: string[];
  b_run_types?: RunType[];
  b_lift_focus?: string[];
};
export type NoBackToBackHardParams = {
  hard_run_types: RunType[];
  hard_lift_focus: string[];
};
export type MaxDaysWithoutRestParams = { max_days: number };
export type BusyBlockOverlapParams = Record<string, never>;

type RuleBase = {
  id: string;
  user_id: string;
  enabled: boolean;
  name: string | null;
  created_at: string;
};

export type ConflictRule =
  | (RuleBase & {
      rule_type: "min_hours_between";
      session_type_a: SessionType | null;
      session_type_b: SessionType | null;
      params: MinHoursBetweenParams;
    })
  | (RuleBase & { rule_type: "no_back_to_back_hard"; session_type_a: null; session_type_b: null; params: NoBackToBackHardParams })
  | (RuleBase & { rule_type: "max_days_without_rest"; session_type_a: null; session_type_b: null; params: MaxDaysWithoutRestParams })
  | (RuleBase & { rule_type: "busy_block_overlap"; session_type_a: null; session_type_b: null; params: BusyBlockOverlapParams });

export type ConflictRuleType = ConflictRule["rule_type"];

// ---- RPC argument shapes (supabase.rpc(name, args)) -----------------------
// All return the affected session/routine id (uuid string) unless noted.

export type RpcArgs = {
  log_run: {
    p_date: string;
    p_run_type: RunType;
    p_distance_km: number;
    p_duration_sec: number;
    p_avg_hr?: number | null;
    p_elevation_gain_m?: number | null;
    p_notes?: string | null;
  };
  plan_run: {
    p_date: string;
    p_run_type: RunType;
    p_start_time?: string | null; // "HH:MM"
    p_duration_min?: number | null;
    p_target_distance_km?: number | null;
    p_target_duration_sec?: number | null;
    p_target_pace_sec_per_km?: number | null;
  };
  complete_run: {
    p_session_id: string;
    p_distance_km: number;
    p_duration_sec: number;
    p_avg_hr?: number | null;
    p_elevation_m?: number | null;
    p_notes?: string | null;
  };
  plan_lift: {
    p_date: string;
    p_focus: string;
    p_start_time?: string | null;
    p_duration_min?: number | null;
    p_routine_id?: string | null;
    p_notes?: string | null;
  };
  log_lift: {
    p_session_id: string | null; // null = new ad-hoc lift
    p_date: string;
    p_focus: string;
    p_notes: string | null;
    p_sets: LiftSetInput[];
  };
  save_routine: {
    p_routine_id: string | null; // null = create
    p_name: string;
    p_exercises: { exercise_id: string; target_sets: number | null; target_reps: number | null }[];
  };
  reschedule_session: { p_session_id: string; p_date: string; p_start_time: string | null };
  set_session_status: { p_session_id: string; p_status: SessionStatus };
  delete_session: { p_session_id: string }; // returns void
  seed_default_conflict_rules: Record<string, never>; // returns void
};

// weight in lb (convert from the user's unit before sending).
export type LiftSetInput = {
  exercise_id: string;
  set_type: SetType;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
};
