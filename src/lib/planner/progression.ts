// Turns the base week into a block: build weeks that grow, deloads, and the race and recovery
// weeks around a race goal. Weekdays never move; only durations and prescriptions change.

import { MAX_RUN_GROWTH } from "./constraints/runVolumeProgression";
import { addDays, diffDays, isoWeekday } from "../time";
import { clamp, dayBudget, round5, runIntensity, type BaseSession, type BaseWeek, type RunKind } from "./model";
import { kindRationale } from "./rationale";
import {
  buildEasyRun,
  buildHardRun,
  buildHardRunByTotal,
  buildLongRun,
  buildRace,
  MIN_EASY_RUN,
  MIN_HARD_RUN,
  type BuiltRun,
} from "./runs";
import { buildLiftPrescription, liftRpe, maxSets, minutesForSets } from "./splits";
import type {
  Experience,
  GeneratedSession,
  GeneratedWeek,
  LiftPrescription,
  TrainingProfile,
  WeekKind,
  WeekTotals,
  Weekday,
} from "./types";

const RUN_GROWTH: Record<Experience, number> = { beginner: 0.05, intermediate: 0.08, advanced: 0.1 };
const DELOAD_FACTOR = 0.6;
const RECOVERY_FACTOR = 0.5;
const CYCLE = 4;

type RunItem = { base: BaseSession; runType: RunKind; built: BuiltRun; hardMin: number };
type LiftItem = { base: BaseSession; sets: number; durationMin: number };
type WeekState = { runs: RunItem[]; lifts: LiftItem[] };

export type Race = { distanceKm: number; date: string };

export type BlockInput = {
  profile: TrainingProfile;
  base: BaseWeek;
  startDate: string;
  weeks: number;
  race: Race | null;
};

// ---- week kinds ------------------------------------------------------------------------------

export function raceWeekIndex(startDate: string, weeks: number, race: Race | null): number | null {
  if (!race) return null;
  const days = diffDays(startDate, race.date);
  if (days < 0) return null;
  const idx = Math.floor(days / 7) + 1;
  return idx <= weeks ? idx : null;
}

export function weekKind(w: number, raceWeek: number | null): WeekKind {
  if (raceWeek !== null && w === raceWeek) return "race";
  if (raceWeek !== null && w > raceWeek) return "recovery";
  return (w - 1) % CYCLE === CYCLE - 1 ? "deload" : "build";
}

// ---- runs --------------------------------------------------------------------------------------

const isHardRun = (r: RunItem) => r.runType === "tempo" || r.runType === "interval";

function initialRuns(base: BaseWeek): RunItem[] {
  return base.sessions
    .filter((s) => s.type === "run")
    .map((s) => {
      const runType = s.runType as RunKind;
      const built = runType === "tempo" || runType === "interval" ? buildHardRun(runType, s.hardMin, s.warmupMin, base.experience) : null;
      // Hard runs are rebuilt from their hard minutes; shrunk easy/long runs keep the placed length.
      return {
        base: s,
        runType,
        built: built ?? (runType === "long" ? buildLongRun(s.durationMin) : buildEasyRun(s.durationMin)),
        hardMin: built ? built.prescription.hardMin : 0,
      };
    });
}

type ScaleOptions = {
  factor: number;
  grow: boolean; // build week: never below last week
  cap: number | null; // max weekly run minutes
  hardToEasy: boolean;
  tempoOnly: boolean;
  week: number;
  exp: Experience;
  rooms: Map<string, number>; // minutes left for each run on its day
};

const MIN_INTERVAL_SESSION = 35; // shorter sessions are too small for a meaningful set of reps

// A single hard run alternates: tempo on odd weeks, intervals on even ones. Deloads and
// sessions too short for a useful set of reps stay tempo.
function hardTypeFor(r: RunItem, o: ScaleOptions, size: number): "tempo" | "interval" {
  if (!r.base.alternates) return r.runType as "tempo" | "interval";
  return o.week % 2 === 1 || o.tempoOnly || size < MIN_INTERVAL_SESSION ? "tempo" : "interval";
}

const roomOf = (o: ScaleOptions, r: RunItem) => o.rooms.get(r.base.id) ?? Infinity;

// A run of `size` minutes in this week's form (hard runs may swap type or turn easy).
function sizedRun(r: RunItem, size: number, o: ScaleOptions): RunItem {
  if (isHardRun(r) && !o.hardToEasy) {
    const runType = hardTypeFor(r, o, size);
    const built = buildHardRunByTotal(runType, size, r.base.warmupMin, o.exp);
    return { base: r.base, runType, built, hardMin: built.prescription.hardMin };
  }
  const runType: RunKind = isHardRun(r) ? "easy" : r.runType;
  return { base: r.base, runType, built: runType === "long" ? buildLongRun(size) : buildEasyRun(size), hardMin: 0 };
}

const MAX_HARD_SHARE = 0.27; // hard work may not exceed this share of a week's running
const TOP_UP_HARD_SHARE = 0.24; // ...and extra growth minutes stop going to hard runs above this

function hardShare(items: RunItem[]): number {
  const total = items.reduce((a, r) => a + r.built.durationMin, 0);
  return total > 0 ? items.reduce((a, r) => a + r.hardMin, 0) / total : 0;
}

function minOf(r: RunItem, o: ScaleOptions): number {
  return isHardRun(r) && !o.hardToEasy ? MIN_HARD_RUN : Math.min(MIN_EASY_RUN, r.built.durationMin);
}

function scaleRuns(prev: RunItem[], o: ScaleOptions): RunItem[] {
  const prevTotal = prev.reduce((a, r) => a + r.built.durationMin, 0);
  const sizes = new Map<string, number>();
  for (const r of prev) {
    const dur = r.built.durationMin;
    let size = round5(dur * o.factor);
    if (o.grow) size = Math.max(size, dur);
    size = Math.max(size, minOf(r, o));
    sizes.set(r.base.id, Math.min(size, roomOf(o, r)));
  }
  const assemble = () => {
    const items = prev.map((r) => {
      const next = sizedRun(r, sizes.get(r.base.id) as number, o);
      return next.built.durationMin <= roomOf(o, r) ? next : r;
    });
    return { items, total: items.reduce((a, r) => a + r.built.durationMin, 0) };
  };
  // Long and easy runs take extra minutes before hard runs do.
  const priority = [...prev.filter((r) => !isHardRun(r)), ...prev.filter(isHardRun)];

  let result = assemble();
  // Rounding to 5 can swallow small growth; top up while there is headroom. A bump is
  // skipped when it would break the cap or let hard work take over the week.
  for (let i = 0; o.grow && i < 12 && result.total < prevTotal * o.factor - 2.5; i++) {
    let grew = false;
    for (const r of priority) {
      const id = r.base.id;
      const size = sizes.get(id) as number;
      if (size + 5 > roomOf(o, r)) continue;
      sizes.set(id, size + 5);
      const next = assemble();
      const ok = next.total > result.total && (o.cap === null || next.total <= o.cap) && hardShare(next.items) <= TOP_UP_HARD_SHARE;
      if (ok) {
        result = next;
        grew = true;
        break;
      }
      sizes.set(id, size);
    }
    if (!grew) break;
  }
  // Lighter weeks: minimum lengths can leave the total above the target, so trim the biggest runs.
  for (let i = 0; !o.grow && i < 60 && result.total > prevTotal * o.factor + 2.5; i++) {
    const trim = prev
      .map((r) => ({ r, room: (sizes.get(r.base.id) as number) - minOf(r, o) }))
      .filter((x) => x.room >= 5)
      .sort((a, b) => b.room - a.room)[0];
    if (!trim) break;
    sizes.set(trim.r.base.id, (sizes.get(trim.r.base.id) as number) - 5);
    result = assemble();
  }
  // Keep hard work from creeping up.
  for (let i = 0; i < 20 && hardShare(result.items) > MAX_HARD_SHARE; i++) {
    const biggest = priority
      .filter((r) => isHardRun(r) && !o.hardToEasy && (sizes.get(r.base.id) as number) - 5 >= MIN_HARD_RUN)
      .sort((a, b) => (sizes.get(b.base.id) as number) - (sizes.get(a.base.id) as number))[0];
    if (!biggest) break;
    sizes.set(biggest.base.id, (sizes.get(biggest.base.id) as number) - 5);
    result = assemble();
  }
  // Enforce the cap by taking minutes back from whatever grew most.
  for (let i = 0; o.cap !== null && result.total > o.cap && i < 60; i++) {
    const grown = priority
      .map((r) => ({ r, d: (sizes.get(r.base.id) as number) - r.built.durationMin }))
      .filter((x) => x.d > 0)
      .sort((a, b) => b.d - a.d)[0];
    if (!grown) return prev;
    sizes.set(grown.r.base.id, (sizes.get(grown.r.base.id) as number) - 5);
    result = assemble();
  }
  if (o.cap !== null && result.total > o.cap) return prev;
  return o.grow ? result.items : dropToTarget(result.items, prevTotal * o.factor);
}

// Minimum lengths can keep a light week well above its target; skip easy runs (shortest first)
// until it is close, always keeping at least one run.
function dropToTarget(items: RunItem[], target: number): RunItem[] {
  const out = [...items];
  const total = () => out.reduce((a, r) => a + r.built.durationMin, 0);
  while (out.length > 1 && total() > target + 10) {
    const easy = out.filter((r) => r.runType === "easy").sort((a, b) => a.built.durationMin - b.built.durationMin)[0];
    if (!easy || out.every((r) => r === easy || isHardRun(r))) break; // keep an easy or long run
    const without = total() - easy.built.durationMin;
    if (Math.abs(without - target) > Math.abs(total() - target)) break;
    out.splice(out.indexOf(easy), 1);
  }
  return out;
}

// ---- lifts -------------------------------------------------------------------------------------

function initialLifts(base: BaseWeek): LiftItem[] {
  return base.sessions.filter((s) => s.type === "lift").map((s) => ({ base: s, sets: s.sets, durationMin: s.durationMin }));
}

function otherMinutes(items: RunItem[], weekday: Weekday): number {
  return items.filter((r) => r.base.weekday === weekday).reduce((a, r) => a + r.built.durationMin, 0);
}

function buildLift(l: LiftItem, buildIdx: number, prev: WeekState, input: BlockInput): LiftItem {
  const base = l.base;
  const variant = base.variant ?? "volume";
  let sets = l.sets;
  let durationMin = l.durationMin;
  if (buildIdx >= 2) {
    const room = dayBudget(input.profile, base.weekday) - otherMinutes(prev.runs, base.weekday);
    const want = sets + Math.max(1, Math.round(sets * 0.1));
    const fit = Math.min(want, maxSets(room, variant, input.base.experience));
    if (fit > sets) {
      sets = fit;
      durationMin = Math.max(durationMin, Math.min(room, minutesForSets(sets, variant)));
    }
  }
  return { base, sets, durationMin };
}

function reducedLift(ref: LiftItem, factor: number): LiftItem {
  const sets = Math.max(2, Math.round(ref.sets * factor));
  const floor = Math.min(30, ref.base.durationMin);
  const durationMin = clamp(Math.max(minutesForSets(sets, "deload"), round5(ref.durationMin * factor)), floor, ref.durationMin);
  return { base: ref.base, sets, durationMin };
}

// ---- sessions ----------------------------------------------------------------------------------

type Ctx = { input: BlockInput; week: number; kind: WeekKind; startDate: string };

function sessionBase(c: Ctx, s: BaseSession) {
  return {
    key: `w${c.week}-${s.weekday}-${s.type}`,
    week: c.week,
    date: addDays(c.startDate, s.weekday - 1),
    weekday: s.weekday,
    slot: s.slot,
  };
}

function runSession(c: Ctx, r: RunItem): GeneratedSession {
  const kindText = kindRationale(c.kind, "run");
  return {
    ...sessionBase(c, r.base),
    type: "run",
    runType: r.runType,
    liftFocus: null,
    heavyLower: false,
    intensity: runIntensity(r.runType),
    durationMin: r.built.durationMin,
    prescription: r.built.prescription,
    rationale: kindText ?? r.base.rationale,
  };
}

function liftSession(c: Ctx, l: LiftItem, buildIdx: number): GeneratedSession {
  const b = l.base;
  const build = c.kind === "build";
  const variant = build ? (b.variant ?? "volume") : "deload";
  const prescription: LiftPrescription = buildLiftPrescription({
    focus: b.liftFocus ?? "full-body",
    variant,
    totalSets: l.sets,
    ratio: c.input.base.ratio,
    rpe: liftRpe(variant, buildIdx),
  });
  const kindText = kindRationale(c.kind, "lift");
  return {
    ...sessionBase(c, b),
    type: "lift",
    runType: null,
    liftFocus: b.liftFocus,
    heavyLower: b.heavyLower,
    intensity: build && variant === "heavy" ? "hard" : "moderate",
    durationMin: l.durationMin,
    prescription,
    rationale: kindText ?? b.rationale,
  };
}

function totalsOf(sessions: GeneratedSession[]): WeekTotals {
  const t: WeekTotals = { runMin: 0, hardRunMin: 0, liftMin: 0, liftSets: 0 };
  for (const s of sessions) {
    if (s.prescription.kind === "run") {
      t.runMin += s.durationMin;
      t.hardRunMin += s.prescription.hardMin;
    } else {
      t.liftMin += s.durationMin;
      t.liftSets += s.prescription.totalSets;
    }
  }
  return t;
}

function raceSession(c: Ctx, race: Race): GeneratedSession {
  const built = buildRace(race.distanceKm);
  const weekday = isoWeekday(race.date) as Weekday;
  return {
    key: `w${c.week}-${weekday}-run`,
    week: c.week,
    date: race.date,
    weekday,
    slot: null,
    type: "run",
    runType: "race",
    liftFocus: null,
    heavyLower: false,
    intensity: "hard",
    durationMin: built.durationMin,
    prescription: built.prescription,
    rationale: "Race day",
  };
}

// Race week: nothing the day before or on race day, no heavy legs in the three days before.
function applyRace(sessions: GeneratedSession[], race: Race): GeneratedSession[] {
  const dayBefore = addDays(race.date, -1);
  return sessions.filter((s) => {
    if (s.date === race.date || s.date === dayBefore) return false;
    const toRace = diffDays(s.date, race.date);
    return !(s.type === "lift" && s.heavyLower && toRace >= 1 && toRace <= 3);
  });
}

const slotOrder = (s: GeneratedSession) => (s.slot === "am" ? 0 : s.slot === null ? 1 : 2);

// ---- the block ---------------------------------------------------------------------------------

export function buildWeeks(input: BlockInput): GeneratedWeek[] {
  const { profile, base } = input;
  const raceWeek = raceWeekIndex(input.startDate, input.weeks, input.race);
  const growth = RUN_GROWTH[base.experience];
  let lastBuild: WeekState = { runs: initialRuns(base), lifts: initialLifts(base) };
  const out: GeneratedWeek[] = [];

  for (let w = 1; w <= input.weeks; w++) {
    const kind = weekKind(w, raceWeek);
    const buildIdx = (w - 1) % CYCLE;
    const startDate = addDays(input.startDate, (w - 1) * 7);
    const c: Ctx = { input, week: w, kind, startDate };

    const lifts = liftsFor(kind, buildIdx, lastBuild, input);
    const rooms = new Map<string, number>(
      lastBuild.runs.map((r) => [
        r.base.id,
        dayBudget(profile, r.base.weekday) - lifts.filter((l) => l.base.weekday === r.base.weekday).reduce((a, l) => a + l.durationMin, 0),
      ]),
    );
    const runs = runsFor(kind, w, growth, lastBuild, input, rooms);

    let sessions = [...runs.map((r) => runSession(c, r)), ...lifts.map((l) => liftSession(c, l, buildIdx))];
    if (kind === "race" && input.race) sessions = [...applyRace(sessions, input.race), raceSession(c, input.race)];
    sessions.sort((a, b) => a.weekday - b.weekday || slotOrder(a) - slotOrder(b));

    out.push({ index: w, kind, startDate, sessions, totals: totalsOf(sessions) });
    if (kind === "build") lastBuild = { runs, lifts };
  }
  return out;
}

function liftsFor(kind: WeekKind, buildIdx: number, last: WeekState, input: BlockInput): LiftItem[] {
  if (kind === "build") {
    const start = initialLifts(input.base);
    // Week 1 and each cycle restart from the base sets; week 3 of a cycle adds a set or two.
    return start.map((l) => buildLift(l, buildIdx, last, input));
  }
  const factor = kind === "recovery" ? RECOVERY_FACTOR : DELOAD_FACTOR;
  return last.lifts.map((l) => reducedLift(l, factor));
}

function runsFor(
  kind: WeekKind,
  w: number,
  growth: number,
  last: WeekState,
  input: BlockInput,
  rooms: Map<string, number>,
): RunItem[] {
  const exp = input.base.experience;
  const lastTotal = last.runs.reduce((a, r) => a + r.built.durationMin, 0);
  if (kind === "build") {
    if (w === 1) return last.runs;
    return scaleRuns(last.runs, {
      factor: 1 + growth,
      grow: true,
      cap: Math.floor(lastTotal * MAX_RUN_GROWTH + 1e-9),
      hardToEasy: false,
      tempoOnly: false,
      week: w,
      exp,
      rooms,
    });
  }
  const factor = kind === "recovery" ? RECOVERY_FACTOR : DELOAD_FACTOR;
  return scaleRuns(last.runs, { factor, grow: false, cap: null, hardToEasy: kind === "recovery", tempoOnly: kind === "deload", week: w, exp, rooms });
}
