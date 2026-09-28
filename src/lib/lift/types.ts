export type SetType = "warmup" | "working" | "drop" | "failure";

export type PrRecordType =
  | "heaviest_weight"
  | "best_e1rm"
  | "most_reps"
  | "best_volume";

export type Exercise = {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  is_custom: boolean;
};

export type LiftSet = {
  id: string;
  lift_details_id: string;
  exercise_id: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
  set_type: SetType;
  superset_group: string | null;
  created_at: string;
};

export type PrHit = {
  exercise_id: string;
  exercise_name: string;
  record_type: PrRecordType;
  value: number;
  weight: number | null;
  reps: number | null;
};

export type Routine = {
  id: string;
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
  exercise: Exercise;
};

// The equipment column is null on 77 seeded rows; the picker groups those
// under a real label instead of dropping them from filter results.
export const UNSPECIFIED_EQUIPMENT = "Unspecified";

// Rest length used when an exercise has no row in exercise_rest_prefs.
// 2 minutes is a middle-of-the-road compound-lift rest.
export const DEFAULT_REST_SECONDS = 120;

export const PR_LABELS: Record<PrRecordType, string> = {
  heaviest_weight: "Heaviest weight",
  best_e1rm: "Best estimated 1RM",
  most_reps: "Most reps at weight",
  best_volume: "Best set volume",
};

export const SET_TYPE_LABELS: Record<SetType, string> = {
  working: "Working",
  warmup: "Warm-up",
  drop: "Drop",
  failure: "Failure",
};
