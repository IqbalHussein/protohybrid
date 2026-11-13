import { SET_TYPES, type LiftSetInput, type SetType, type WeightUnit } from "./types";
import { isValidDate } from "./time";
import { toStoredWeight } from "./units";

// Lift maths (e1RM, volume) and validation of the lift and routine forms.
// e1rm and sessionVolume mirror rebuild_prs() in 0003 so the UI and stored
// PRs agree.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// Estimated one-rep max (Epley), matching rebuild_prs() in SQL: only for
// 1–12 reps with a positive weight, rounded to 0.1.
export function e1rm(weight: number | null | undefined, reps: number | null | undefined): number | null {
  if (!weight || weight <= 0 || !reps || reps < 1 || reps > 12) return null;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

export function setVolume(weight: number | null | undefined, reps: number | null | undefined): number {
  return (weight ?? 0) * (reps ?? 0);
}

// Total volume (weight x reps) of a session's sets.
export function sessionVolume(sets: { set_type: SetType; weight: number | null; reps: number | null }[]): number {
  // Same rule as rebuild_prs' best_volume: working and failure sets only.
  return sets.reduce(
    (sum, s) => (s.set_type === "working" || s.set_type === "failure" ? sum + setVolume(s.weight, s.reps) : sum),
    0,
  );
}

// Groups sets by exercise in order of first appearance, keeping set order.
export function groupByExercise<T extends { exercise_id: string }>(sets: T[]): { exercise_id: string; sets: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const s of sets) {
    const list = groups.get(s.exercise_id);
    if (list) list.push(s);
    else groups.set(s.exercise_id, [s]);
  }
  return Array.from(groups, ([exercise_id, list]) => ({ exercise_id, sets: list }));
}

// ---- Form payloads ---------------------------------------------------------
// Client forms post their state as JSON in a hidden "payload" field, with
// numbers as the raw strings the user typed. These parse and validate it.

// original: stored lb + the text initially shown. When the submitted weight
// still equals that text, the stored lb is kept as-is (no rounding drift).
export type LiftFormSet = {
  setType: string;
  reps: string;
  weight: string;
  rpe: string;
  original?: { shown: string; lb: number };
};
export type LiftFormGroup = { exerciseId: string | null; sets: LiftFormSet[] };
export type LiftFormPayload = {
  sessionId: string | null;
  date: string;
  focus: string;
  notes: string;
  groups: LiftFormGroup[];
};

export type ParsedLift = {
  sessionId: string | null;
  date: string;
  focus: string;
  notes: string | null;
  sets: LiftSetInput[];
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

// "" -> null; otherwise a finite number or NaN.
function num(v: unknown): number | null {
  const s = str(v);
  if (s === "") return null;
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Weight is entered in `unit` and returned in lb.
export function parseLiftPayload(raw: unknown, unit: WeightUnit): Result<ParsedLift> {
  const p = parseJson(raw) as Partial<LiftFormPayload> | null;
  if (!p || typeof p !== "object") return { ok: false, error: "The form couldn't be read. Reload and try again." };

  const sessionId = p.sessionId ?? null;
  if (sessionId !== null && !isUuid(sessionId)) return { ok: false, error: "That lift can't be found." };

  const date = str(p.date);
  if (!isValidDate(date)) return { ok: false, error: "Pick a date." };

  const focus = str(p.focus);
  if (!focus) return { ok: false, error: "Choose a focus." };
  if (focus.length > 50) return { ok: false, error: "Focus must be 50 characters or fewer." };

  const notes = str(p.notes);
  if (notes.length > 2000) return { ok: false, error: "Notes must be 2000 characters or fewer." };

  if (!Array.isArray(p.groups)) return { ok: false, error: "Add at least one set." };

  const sets: LiftSetInput[] = [];
  for (const [gi, g] of p.groups.entries()) {
    const rows = Array.isArray(g?.sets) ? g.sets : [];
    const label = `Exercise ${gi + 1}`;
    const filled = rows.filter((r) => str(r?.reps) !== "" || str(r?.weight) !== "" || str(r?.rpe) !== "");
    if (filled.length === 0) continue;
    if (!isUuid(g?.exerciseId)) return { ok: false, error: `${label}: choose an exercise.` };

    for (const [si, r] of rows.entries()) {
      if (str(r?.reps) === "" && str(r?.weight) === "" && str(r?.rpe) === "") continue;
      const where = `${label}, set ${si + 1}`;

      const setType = str(r.setType) || "working";
      if (!(SET_TYPES as readonly string[]).includes(setType)) return { ok: false, error: `${where}: choose a set type.` };

      const reps = num(r.reps);
      if (reps !== null && (!Number.isInteger(reps) || reps < 0 || reps > 1000))
        return { ok: false, error: `${where}: reps must be a whole number from 0 to 1000.` };

      const weightIn = num(r.weight);
      if (weightIn !== null && (Number.isNaN(weightIn) || weightIn < 0))
        return { ok: false, error: `${where}: weight must be 0 or more.` };
      const original = r.original;
      const keepOriginal =
        weightIn !== null &&
        original != null &&
        typeof original.lb === "number" &&
        Number.isFinite(original.lb) &&
        original.lb >= 0 &&
        str(original.shown) === str(r.weight);
      const weight = weightIn === null ? null : keepOriginal ? original!.lb : toStoredWeight(weightIn, unit);
      if (weight !== null && weight > 5000) return { ok: false, error: `${where}: weight is too high.` };

      const rpe = num(r.rpe);
      if (rpe !== null && (Number.isNaN(rpe) || rpe < 1 || rpe > 10))
        return { ok: false, error: `${where}: RPE must be from 1 to 10.` };

      sets.push({ exercise_id: g.exerciseId as string, set_type: setType as SetType, reps, weight, rpe });
    }
  }

  if (sets.length === 0) return { ok: false, error: "Add at least one set with reps or weight." };
  if (sets.length > 500) return { ok: false, error: "A lift can have at most 500 sets." };

  return { ok: true, value: { sessionId, date, focus, notes: notes || null, sets } };
}

export type RoutineFormItem = { exerciseId: string | null; targetSets: string; targetReps: string };
export type RoutineFormPayload = { routineId: string | null; name: string; exercises: RoutineFormItem[] };
export type ParsedRoutine = {
  routineId: string | null;
  name: string;
  exercises: { exercise_id: string; target_sets: number | null; target_reps: number | null }[];
};

export function parseRoutinePayload(raw: unknown): Result<ParsedRoutine> {
  const p = parseJson(raw) as Partial<RoutineFormPayload> | null;
  if (!p || typeof p !== "object") return { ok: false, error: "The form couldn't be read. Reload and try again." };

  const routineId = p.routineId ?? null;
  if (routineId !== null && !isUuid(routineId)) return { ok: false, error: "That routine can't be found." };

  const name = str(p.name);
  if (!name) return { ok: false, error: "Name the routine." };
  if (name.length > 100) return { ok: false, error: "Routine names must be 100 characters or fewer." };

  const items = Array.isArray(p.exercises) ? p.exercises : [];
  const exercises: ParsedRoutine["exercises"] = [];
  for (const [i, item] of items.entries()) {
    const where = `Exercise ${i + 1}`;
    if (!isUuid(item?.exerciseId)) return { ok: false, error: `${where}: choose an exercise.` };
    const sets = num(item.targetSets);
    if (sets !== null && (!Number.isInteger(sets) || sets < 1 || sets > 50))
      return { ok: false, error: `${where}: target sets must be a whole number from 1 to 50.` };
    const reps = num(item.targetReps);
    if (reps !== null && (!Number.isInteger(reps) || reps < 1 || reps > 1000))
      return { ok: false, error: `${where}: target reps must be a whole number from 1 to 1000.` };
    exercises.push({ exercise_id: item.exerciseId as string, target_sets: sets, target_reps: reps });
  }
  if (exercises.length === 0) return { ok: false, error: "Add at least one exercise." };

  return { ok: true, value: { routineId, name, exercises } };
}

export const SET_TYPE_LABELS: Record<SetType, string> = {
  warmup: "Warm-up",
  working: "Working",
  drop: "Drop",
  failure: "To failure",
};

export const PR_LABELS = {
  heaviest_weight: "Heaviest",
  best_e1rm: "Best e1RM",
  most_reps: "Most reps",
  best_volume: "Best volume",
} as const;

export function focusLabel(focus: string): string {
  if (focus === "full-body") return "Full body";
  return focus.charAt(0).toUpperCase() + focus.slice(1);
}
