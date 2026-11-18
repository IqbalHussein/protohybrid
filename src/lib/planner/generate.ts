// The plan generator: profile in, block out. Pure and deterministic.
// Steps: choose days -> allocate minutes -> place sessions (baseWeek.ts), then
// roll the base week forward into weeks with progression, deloads and race handling.

import { isoWeekday, isValidDate } from "../time";
import { planBaseWeek, budgetPhrase } from "./baseWeek";
import { BLOCK_CONSTRAINTS, WEEK_CONSTRAINTS } from "./constraints";
import { weekLayoutOf } from "./layout";
import { budgetsOf, type BaseWeek } from "./model";
import { buildWeeks, raceWeekIndex, type Race } from "./progression";
import { splitLabel } from "./splits";
import type {
  GenerateOptions,
  GeneratedBlock,
  GeneratedWeek,
  LiftFocus,
  Relaxation,
  TrainingProfile,
  Weekday,
} from "./types";

export const GENERATOR_VERSION = "1.0.0";
const MAX_WEEKS = 52;

// ---- race goal ---------------------------------------------------------------------------------

// [distance km, recommended weekly run minutes, recommended long run minutes]
const RACE_TABLE: [number, number, number][] = [
  [5, 90, 40],
  [10, 120, 60],
  [21.1, 180, 90],
  [42.2, 240, 120],
];

export function recommendedRaceVolume(km: number): { weeklyMin: number; longMin: number } {
  if (km <= RACE_TABLE[0][0]) return { weeklyMin: RACE_TABLE[0][1], longMin: RACE_TABLE[0][2] };
  for (let i = 1; i < RACE_TABLE.length; i++) {
    const [d0, w0, l0] = RACE_TABLE[i - 1];
    const [d1, w1, l1] = RACE_TABLE[i];
    if (km <= d1) {
      const t = (km - d0) / (d1 - d0);
      return { weeklyMin: Math.round(w0 + t * (w1 - w0)), longMin: Math.round(l0 + t * (l1 - l0)) };
    }
  }
  const last = RACE_TABLE[RACE_TABLE.length - 1];
  return { weeklyMin: last[1], longMin: last[2] };
}

function raceLabel(km: number): string {
  if (km <= 7.5) return "5k";
  if (km <= 15) return "10k";
  if (km <= 30) return "half marathon";
  if (km >= 38) return "marathon";
  return `${km} km race`;
}

const hours = (min: number) => (min >= 120 ? `${Math.round((min / 60) * 10) / 10} h` : `${min} min`);

function goalVolumeNote(profile: TrainingProfile, weeks: GeneratedWeek[], days: Weekday[]): Relaxation | null {
  if (profile.goal.type !== "race" || days.length === 0) return null;
  const rec = recommendedRaceVolume(profile.goal.distanceKm);
  const peak = Math.max(0, ...weeks.filter((w) => w.kind === "build").map((w) => w.totals.runMin));
  const longest = Math.max(
    0,
    ...weeks.flatMap((w) => w.sessions.filter((s) => s.runType === "long").map((s) => s.durationMin)),
  );
  if (peak >= rec.weeklyMin * 0.9 && longest >= rec.longMin * 0.9) return null;
  const label = raceLabel(profile.goal.distanceKm);
  return {
    constraint: "goalVolume",
    title: `Running volume is below the usual for a ${label}`,
    detail:
      `A ${label} block usually builds long runs of about ${hours(rec.longMin)} and ${rec.weeklyMin} min of running a week. ` +
      `With ${budgetPhrase(days, budgetsOf(profile))}, this plan peaks at a ${longest} min long run and ${peak} min of running a week.`,
  };
}

// ---- summary and checks ------------------------------------------------------------------------

function summarize(block: Pick<GeneratedBlock, "weeks">, base: BaseWeek, weekCount: number): string {
  const lifts = base.sessions.filter((s) => s.type === "lift");
  const runs = base.sessions.filter((s) => s.type === "run");
  if (base.sessions.length === 0) return `${weekCount}-week block: no training days available.`;
  const minutes = Math.round(base.sessions.reduce((a, s) => a + s.durationMin, 0) / 10) * 10;
  const parts = [
    ...(lifts.length ? [`${lifts.length} lift${lifts.length > 1 ? "s" : ""}`] : []),
    ...(runs.length ? [`${runs.length} run${runs.length > 1 ? "s" : ""}`] : []),
  ];
  const notes: string[] = [];
  if (lifts.length) notes.push(`${splitLabel(lifts.map((l) => l.liftFocus as LiftFocus))} split`);
  for (const w of block.weeks) {
    if (w.kind === "deload") notes.push(`week ${w.index} deload`);
    if (w.kind === "race") notes.push(`race in week ${w.index}`);
  }
  const head = `${weekCount}-week block: ${base.sessions.length} session${base.sessions.length > 1 ? "s" : ""} a week (${parts.join(", ")}), about ${minutes} min`;
  return `${head}${notes.map((n) => `, ${n}`).join("")}.`;
}

function addUnique(list: Relaxation[], r: Relaxation) {
  if (!list.some((x) => x.constraint === r.constraint && x.detail === r.detail)) list.push(r);
}

// Hard violations in weeks after the first, and in the block as a whole.
function laterWeekRelaxations(profile: TrainingProfile, block: GeneratedBlock, known: Relaxation[]): Relaxation[] {
  const out: Relaxation[] = [];
  const hard = WEEK_CONSTRAINTS.filter((c) => c.severity === "hard");
  const covered = new Set(known.map((r) => r.constraint));
  for (const week of block.weeks.slice(1)) {
    const layout = weekLayoutOf(profile, week);
    for (const c of hard)
      if (!covered.has(c.id))
        for (const v of c.check(layout))
          addUnique(out, { constraint: c.id, title: c.label, detail: `Week ${week.index}: ${v.message}` });
  }
  for (const c of BLOCK_CONSTRAINTS)
    if (c.severity === "hard")
      for (const v of c.check(block)) addUnique(out, { constraint: c.id, title: c.label, detail: v.message });
  return out;
}

// ---- entry point -------------------------------------------------------------------------------

export function generatePlan(profile: TrainingProfile, options: GenerateOptions): GeneratedBlock {
  const { startDate } = options;
  const weekCount = options.weeks ?? 4;
  if (!isValidDate(startDate) || isoWeekday(startDate) !== 1) throw new Error(`startDate must be a Monday (YYYY-MM-DD), got "${startDate}"`);
  if (!Number.isInteger(weekCount) || weekCount < 1 || weekCount > MAX_WEEKS)
    throw new Error(`weeks must be a whole number from 1 to ${MAX_WEEKS}`);

  const budgets = budgetsOf(profile);
  const plan = planBaseWeek(profile, budgets);
  const race: Race | null =
    profile.goal.type === "race" ? { distanceKm: profile.goal.distanceKm, date: profile.goal.date } : null;
  const relaxations: Relaxation[] = [...plan.relaxations];

  if (race && race.date < startDate)
    relaxations.push({
      constraint: "goalConflict",
      title: "Race date is before this block",
      detail: `The race on ${race.date} is before the block starts on ${startDate}, so no race week was planned.`,
    });

  const weeks = buildWeeks({ profile, base: plan.base, startDate, weeks: weekCount, race: raceWeekIndex(startDate, weekCount, race) === null ? null : race });
  const block: GeneratedBlock = {
    generatorVersion: GENERATOR_VERSION,
    startDate,
    weeks,
    relaxations: [],
    summary: summarize({ weeks }, plan.base, weekCount),
  };
  for (const r of laterWeekRelaxations(profile, block, relaxations)) relaxations.push(r);
  const volume = goalVolumeNote(profile, weeks, plan.days);
  if (volume) relaxations.push(volume);
  block.relaxations = relaxations;
  return block;
}
