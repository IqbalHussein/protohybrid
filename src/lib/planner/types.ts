// Types for the plan builder. The planner is pure and framework-independent:
// a TrainingProfile goes in, a GeneratedBlock comes out. Nothing here touches
// the database, React or the clock.

export type Preset = "builder" | "lifter" | "runner" | "hybrid";
export type Experience = "beginner" | "intermediate" | "advanced";
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO: 1 = Monday

// Focus weights. Each 0..100 and together exactly 100.
export type FocusWeights = { strength: number; hypertrophy: number; endurance: number };

export type Goal =
  | { type: "none" }
  | { type: "strength" }
  | { type: "race"; distanceKm: number; date: string }; // date "YYYY-MM-DD"

export type TrainingProfile = {
  preset: Preset | null; // null = weights adjusted away from any preset
  weights: FocusWeights;
  daysPerWeek: number; // 2..7
  // Time budget per training day. Sessions stacked on one day share it.
  minutesPerDay: number;
  // Optional per-weekday overrides of minutesPerDay. 0 means unavailable.
  minutesByWeekday?: Partial<Record<Weekday, number>>;
  restDays: Weekday[]; // preferred rest days (soft)
  goal: Goal;
  experience: Experience;
};

export type Intensity = "easy" | "moderate" | "hard";
export type PlannedRunType = "easy" | "tempo" | "interval" | "long" | "race";
export type LiftFocus = "full-body" | "upper" | "lower" | "push" | "pull" | "legs";
export type LiftVariant = "heavy" | "volume" | "deload";
// "am"/"pm" only when two sessions share a day; otherwise null.
export type Slot = "am" | "pm" | null;

export type RunPrescription = {
  kind: "run";
  warmupMin: number;
  // Minutes at hard effort (tempo or interval reps). 0 for easy and long runs.
  hardMin: number;
  cooldownMin: number;
  reps: number | null; // intervals only
  repMin: number | null;
  recoveryMin: number | null;
  description: string; // e.g. "10 min easy, 6 × 3 min hard / 2 min jog, 5 min easy"
};

export type LiftExercise = {
  slot: string; // movement pattern, e.g. "Squat"
  name: string; // suggested exercise; matched by name against the library
  sets: number;
  repsLow: number;
  repsHigh: number;
};

export type LiftPrescription = {
  kind: "lift";
  variant: LiftVariant;
  rpe: number;
  restSec: number;
  totalSets: number;
  exercises: LiftExercise[];
  description: string; // e.g. "4 exercises, 14 sets, 3–5 reps @ RPE 8"
};

export type GeneratedSession = {
  key: string; // stable within a block, e.g. "w1-3-run"
  week: number; // 1-based
  date: string; // YYYY-MM-DD
  weekday: Weekday;
  slot: Slot;
  type: "run" | "lift";
  runType: PlannedRunType | null;
  liftFocus: LiftFocus | null;
  heavyLower: boolean; // lift that loads the legs (lower, legs, full-body)
  intensity: Intensity;
  durationMin: number;
  prescription: RunPrescription | LiftPrescription;
  rationale: string;
};

export type WeekKind = "build" | "deload" | "race" | "recovery";

export type WeekTotals = {
  runMin: number;
  hardRunMin: number; // minutes at hard effort
  liftMin: number;
  liftSets: number;
};

export type GeneratedWeek = {
  index: number; // 1-based
  kind: WeekKind;
  startDate: string; // Monday
  sessions: GeneratedSession[];
  totals: WeekTotals;
};

// A constraint that could not be fully met, and what the planner did instead.
export type Relaxation = {
  constraint: string; // constraint id, see constraints/
  title: string;
  detail: string;
};

export type GeneratedBlock = {
  generatorVersion: string;
  startDate: string; // Monday
  weeks: GeneratedWeek[];
  relaxations: Relaxation[];
  summary: string;
};

export type GenerateOptions = {
  startDate: string; // must be a Monday
  weeks?: number; // default 4 (3 build + 1 deload)
};
