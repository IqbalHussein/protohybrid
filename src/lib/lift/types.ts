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

// The equipment column is null on 77 seeded rows; the picker groups those
// under a real label instead of dropping them from filter results.
export const UNSPECIFIED_EQUIPMENT = "Unspecified";
