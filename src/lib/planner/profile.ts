import type { Experience, FocusWeights, Goal, Preset, TrainingProfile, Weekday } from "./types";

// Validation of a training profile coming from a form or the database.
// Returns user-facing messages.

const PRESET_IDS: readonly Preset[] = ["builder", "lifter", "runner", "hybrid"];
const EXPERIENCE: readonly Experience[] = ["beginner", "intermediate", "advanced"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MIN_DAYS = 2;
export const MAX_DAYS = 7;
export const MIN_MINUTES = 10;
export const MAX_MINUTES = 300;

export type ProfileInput = {
  preset?: unknown;
  weights?: { strength?: unknown; hypertrophy?: unknown; endurance?: unknown };
  daysPerWeek?: unknown;
  minutesPerDay?: unknown;
  minutesByWeekday?: unknown;
  restDays?: unknown;
  goal?: { type?: unknown; distanceKm?: unknown; date?: unknown };
  experience?: unknown;
};

type Result = { ok: true; value: TrainingProfile } | { ok: false; error: string };

function int(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isInteger(n) ? n : null;
}

function isWeekday(n: unknown): n is Weekday {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 7;
}

export function validateProfile(input: ProfileInput): Result {
  const preset = input.preset == null || input.preset === "" ? null : input.preset;
  if (preset !== null && !PRESET_IDS.includes(preset as Preset)) return { ok: false, error: "Pick a preset." };

  const s = int(input.weights?.strength);
  const h = int(input.weights?.hypertrophy);
  const e = int(input.weights?.endurance);
  if (s === null || h === null || e === null || s < 0 || h < 0 || e < 0)
    return { ok: false, error: "Weights must be whole numbers from 0 to 100." };
  if (s + h + e !== 100) return { ok: false, error: "Strength, hypertrophy and endurance must add up to 100." };
  const weights: FocusWeights = { strength: s, hypertrophy: h, endurance: e };

  const days = int(input.daysPerWeek);
  if (days === null || days < MIN_DAYS || days > MAX_DAYS)
    return { ok: false, error: `Days per week must be from ${MIN_DAYS} to ${MAX_DAYS}.` };

  const minutes = int(input.minutesPerDay);
  if (minutes === null || minutes < MIN_MINUTES || minutes > MAX_MINUTES)
    return { ok: false, error: `Minutes per day must be from ${MIN_MINUTES} to ${MAX_MINUTES}.` };

  const byWeekday: Partial<Record<Weekday, number>> = {};
  if (input.minutesByWeekday != null) {
    if (typeof input.minutesByWeekday !== "object" || Array.isArray(input.minutesByWeekday))
      return { ok: false, error: "Per-day minutes are malformed." };
    for (const [k, v] of Object.entries(input.minutesByWeekday as Record<string, unknown>)) {
      const day = Number(k);
      const m = int(v);
      if (!isWeekday(day) || m === null || m < 0 || m > MAX_MINUTES)
        return { ok: false, error: `Per-day minutes must be from 0 to ${MAX_MINUTES}.` };
      byWeekday[day] = m;
    }
  }

  const rawRest = input.restDays ?? [];
  if (!Array.isArray(rawRest)) return { ok: false, error: "Rest days are malformed." };
  const restDays = [...new Set(rawRest.map((d) => int(d)))].sort((a, b) => (a ?? 0) - (b ?? 0));
  if (!restDays.every(isWeekday)) return { ok: false, error: "Rest days must be weekdays." };

  let goal: Goal;
  const goalType = input.goal?.type ?? "none";
  if (goalType === "none" || goalType === "") goal = { type: "none" };
  else if (goalType === "strength") goal = { type: "strength" };
  else if (goalType === "race") {
    const raw = input.goal?.distanceKm;
    const km = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    if (!Number.isFinite(km) || km <= 0 || km > 1000) return { ok: false, error: "Race distance must be between 0 and 1000 km." };
    const date = typeof input.goal?.date === "string" ? input.goal.date : "";
    if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return { ok: false, error: "Pick a race date." };
    goal = { type: "race", distanceKm: km, date };
  } else return { ok: false, error: "Pick a goal." };

  const experience = input.experience ?? "intermediate";
  if (!EXPERIENCE.includes(experience as Experience)) return { ok: false, error: "Pick an experience level." };

  return {
    ok: true,
    value: {
      preset: preset as Preset | null,
      weights,
      daysPerWeek: days,
      minutesPerDay: minutes,
      minutesByWeekday: Object.keys(byWeekday).length ? byWeekday : undefined,
      restDays: restDays as Weekday[],
      goal,
      experience: experience as Experience,
    },
  };
}
