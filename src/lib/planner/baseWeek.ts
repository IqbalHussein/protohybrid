// Plans the base week (week 1): choose days, allocate minutes, place sessions.

import { allocate, mergeEasyRuns, NO_CAPS, type Caps, type LiftFloor } from "./allocate";
import { backfill } from "./backfill";
import { WEEK_CONSTRAINTS, type Violation, type WeekLayout } from "./constraints";
import { dayCandidates, restDayNote, type DayCandidate } from "./days";
import {
  wantsLongRun,
  type Allocation,
  type BaseSession,
  type BaseWeek,
  type Budgets,
} from "./model";
import { describeBase } from "./rationale";
import { layoutOfPlaced, placeSessions, type PlaceInput, type Placement } from "./schedule";
import { baseSets } from "./splits";
import type { Relaxation, TrainingProfile, Weekday } from "./types";

const DROP_PENALTY = 500;
const LOST_PENALTY = 0.3; // per minute an easy-run merge cannot hand to another run
const FLOORS: LiftFloor[] = ["strict", "mid", "loose"];
const MAX_DROPS = 20;

export type BaseResult = {
  base: BaseWeek;
  days: Weekday[];
  layout: WeekLayout;
  relaxations: Relaxation[];
  score: number;
};

export function budgetPhrase(days: Weekday[], budgets: Budgets): string {
  const mins = days.map((d) => budgets[d]);
  if (mins.every((m) => m === mins[0])) return `${days.length} × ${mins[0]} min`;
  return `${days.length} days (${mins.reduce((a, b) => a + b, 0)} min in total)`;
}

type Drop = { label: string; apply: (caps: Caps) => Caps };

// What to give up when sessions don't fit: easy runs first, then the modality that
// has more than its share of sessions. The long run goes last.
function chooseDrop(a: Allocation, profile: TrainingProfile): Drop | null {
  const easy = a.runs.filter((r) => r.runType === "easy").length;
  const hard = a.runs.filter((r) => r.runType === "tempo" || r.runType === "interval").length;
  const long = a.runs.some((r) => r.runType === "long");
  const lifts = a.lifts.length;
  const liftWeight = (profile.weights.strength + profile.weights.hypertrophy) / 100;
  const total = lifts + a.runs.length;
  const drops: Record<string, Drop | null> = {
    easy: easy > 0 ? { label: "an easy run", apply: (c) => ({ ...c, easy: easy - 1 }) } : null,
    hard: hard > 0 ? { label: "a hard run", apply: (c) => ({ ...c, hard: hard - 1 }) } : null,
    lift:
      lifts > 1 || (lifts === 1 && liftWeight < 0.2) ? { label: "a lift", apply: (c) => ({ ...c, lifts: lifts - 1 }) } : null,
    long: long ? { label: "the long run", apply: (c) => ({ ...c, long: false }) } : null,
    lastLift: lifts === 1 ? { label: "a lift", apply: (c) => ({ ...c, lifts: 0 }) } : null,
  };
  if (drops.easy) return drops.easy;
  const liftExcess = lifts / total - liftWeight;
  const runExcess = a.runs.length / total - profile.weights.endurance / 100;
  const order = liftExcess >= runExcess ? ["lift", "hard"] : ["hard", "lift"];
  for (const k of [...order, "long", "lastLift"]) if (drops[k]) return drops[k];
  return null;
}

type Planned = {
  alloc: Allocation;
  placement: Placement | null;
  drops: Relaxation[];
  input: PlaceInput | null;
};

// Allocation variants for one drop level, best first. Strict shrink floors come before loose
// ones (a lift is only cut to half when nothing else fits); every variant that has more
// sessions than days also tries merging easy runs away, and a shorter hard-run warm-up.
function variants(profile: TrainingProfile, days: Weekday[], budgets: Budgets, caps: Caps, floor: LiftFloor): Allocation[] {
  const maxBudget = Math.max(0, ...days.map((d) => budgets[d]));
  const out: Allocation[] = [];
  for (const tight of [false, true]) {
    const base = allocate(profile, days, budgets, caps, tight, floor);
    const count = base.lifts.length + base.runs.length;
    if (tight && count <= days.length) continue;
    const easy = base.runs.filter((r) => r.runType === "easy").length;
    const hasLong = base.runs.some((r) => r.runType === "long");
    // an easy run can only be merged into another run, so one run must remain
    const maxMerge = count > days.length ? Math.min(hasLong ? easy : easy - 1, count - days.length) : 0;
    for (let k = 0; k <= Math.max(0, maxMerge); k++) out.push(mergeEasyRuns(base, k, maxBudget));
  }
  return out;
}

// Allocate and place; while the sessions cannot be placed, drop one and try again.
function planDays(profile: TrainingProfile, days: Weekday[], budgets: Budgets, restDays: Weekday[]): Planned {
  let caps = NO_CAPS;
  const drops: Relaxation[] = [];
  const longWanted = wantsLongRun(profile);
  for (let i = 0; i <= MAX_DROPS; i++) {
    for (const floor of FLOORS) {
      let best: Planned | null = null;
      let bestScore = Infinity;
      for (const alloc of variants(profile, days, budgets, caps, floor)) {
        const input = { lifts: alloc.lifts, runs: alloc.runs, days, budgets, restDays, wantsLong: longWanted };
        const placement = placeSessions(input);
        const score = placement ? placement.score + LOST_PENALTY * (alloc.lostMin ?? 0) : 0;
        if (placement && (!best || score < bestScore)) {
          bestScore = score;
          best = { alloc, placement, drops, input };
        }
      }
      if (best) return best;
    }
    const alloc = allocate(profile, days, budgets, caps, false, "loose");
    const count = alloc.lifts.length + alloc.runs.length;
    const drop = count === 0 ? null : chooseDrop(alloc, profile);
    if (!drop) return { alloc, placement: null, drops, input: null };
    drops.push({
      constraint: "timeBudget",
      title: `Dropped ${drop.label}`,
      detail: `Dropped ${drop.label}: ${count} sessions don't fit in ${budgetPhrase(days, budgets)}.`,
    });
    caps = drop.apply(caps);
  }
  return { alloc: allocate(profile, days, budgets, caps, true), placement: null, drops, input: null };
}

// Fills unused day minutes after the search and re-reads the layout.
function finalize(p: Placement, input: PlaceInput, profile: TrainingProfile, budgets: Budgets): Placement {
  const liftTarget = (profile.weights.strength + profile.weights.hypertrophy) / 100;
  const placed = backfill(p.placed, { budgets, liftTarget, experience: profile.experience });
  return { placed, score: p.score, layout: layoutOfPlaced(input, placed) };
}

function toBase(p: Placement, alloc: Allocation, profile: TrainingProfile, budgets: Budgets): BaseWeek {
  const sessions: BaseSession[] = p.placed.map((x) => {
    const s = x.spec;
    const common = { id: s.id, weekday: x.weekday, slot: x.slot, durationMin: x.durationMin, rationale: "" };
    if (s.type === "lift")
      return {
        ...common,
        type: "lift",
        runType: null,
        alternates: false,
        hardMin: 0,
        warmupMin: 0,
        liftFocus: s.focus,
        variant: s.variant,
        heavyLower: s.heavyLower,
        sets: baseSets(x.durationMin, s.variant, profile.experience),
        minDurationMin: s.minDurationMin,
      };
    return {
      ...common,
      type: "run",
      runType: s.runType,
      alternates: s.alternates,
      hardMin: s.hardMin,
      warmupMin: s.warmupMin,
      liftFocus: null,
      variant: null,
      heavyLower: false,
      sets: 0,
      minDurationMin: s.minDurationMin,
    };
  });
  sessions.sort((a, b) => a.weekday - b.weekday || (a.slot === "pm" ? 1 : 0) - (b.slot === "pm" ? 1 : 0));
  const text = describeBase(sessions);
  for (const s of sessions) s.rationale = text.get(s.id) ?? "";
  return { sessions, ratio: alloc.ratio, experience: profile.experience, budgets };
}

// Hard-constraint violations that survived the search, reported as relaxations.
export function hardViolations(layout: WeekLayout): { label: string; v: Violation }[] {
  return WEEK_CONSTRAINTS.filter((c) => c.severity === "hard").flatMap((c) =>
    c.check(layout).map((v) => ({ label: c.label, v })),
  );
}

function emptyBase(profile: TrainingProfile, budgets: Budgets): BaseWeek {
  return { sessions: [], ratio: 0.5, experience: profile.experience, budgets };
}

export function planBaseWeek(profile: TrainingProfile, budgets: Budgets): BaseResult {
  const longWanted = wantsLongRun(profile);
  const candidates = dayCandidates(budgets, profile.daysPerWeek, profile.restDays, longWanted);
  let best: (BaseResult & { total: number }) | null = null;
  for (const cand of candidates) {
    const r = planCandidate(profile, budgets, cand);
    const total = cand.score + r.score;
    if (!best || total < best.total) best = { ...r, total };
  }
  if (best) return best;
  return {
    base: emptyBase(profile, budgets),
    days: [],
    layout: { kind: "build", days: [], restDays: profile.restDays, wantsLongRun: longWanted },
    relaxations: [
      {
        constraint: "timeBudget",
        title: "No training time",
        detail: "Every weekday has 0 minutes available, so no sessions could be planned.",
      },
    ],
    score: 0,
  };
}

function planCandidate(profile: TrainingProfile, budgets: Budgets, cand: DayCandidate): BaseResult {
  const planned = planDays(profile, cand.days, budgets, profile.restDays);
  const relaxations: Relaxation[] = [];
  if (cand.days.length < profile.daysPerWeek)
    relaxations.push({
      constraint: "timeBudget",
      title: "Fewer training days than requested",
      detail: `Only ${cand.days.length} weekdays have time available, so the plan has ${cand.days.length} training days instead of ${profile.daysPerWeek}.`,
    });
  if (cand.restUsed.length > 0)
    relaxations.push({
      constraint: "respectRestDays",
      title: "Training on a preferred rest day",
      detail: `To fit ${cand.days.length} training days, ${restDayNote(cand.restUsed)} ${cand.restUsed.length > 1 ? "are" : "is"} used although marked as rest.`,
    });
  relaxations.push(...planned.alloc.notes, ...planned.drops);
  const placement = planned.placement && planned.input ? finalize(planned.placement, planned.input, profile, budgets) : null;
  const layout: WeekLayout = placement?.layout ?? { kind: "build", days: [], restDays: profile.restDays, wantsLongRun: wantsLongRun(profile) };
  if (placement) {
    const explicit = new Set(relaxations.map((r) => r.constraint));
    for (const { label, v } of hardViolations(layout))
      if (!explicit.has(v.constraint))
        relaxations.push({
          constraint: v.constraint,
          title: label,
          detail: `Only ${cand.days.length} training days: ${v.message}`,
        });
  }
  const base = placement ? toBase(placement, planned.alloc, profile, budgets) : emptyBase(profile, budgets);
  const score = (placement?.score ?? 0) + planned.drops.length * DROP_PENALTY + (placement ? 0 : 5000);
  return { base, days: cand.days, layout, relaxations, score };
}
