// One or two plain sentences per session, built from where it sits in the week.

import { dayName, type BaseSession } from "./model";
import { focusLabel } from "./splits";
import type { Weekday, WeekKind } from "./types";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const prevDay = (d: Weekday): Weekday => (d === 1 ? 7 : ((d - 1) as Weekday));

function runName(s: BaseSession): string {
  if (s.runType === "tempo") return "tempo run";
  if (s.runType === "interval") return "interval run";
  if (s.runType === "long") return "long run";
  return "easy run";
}

function liftName(s: BaseSession): string {
  return `${s.variant === "heavy" ? "heavy " : ""}${focusLabel(s.liftFocus ?? "full-body")} lift`;
}

function isHard(s: BaseSession): boolean {
  return s.type === "lift" ? s.variant === "heavy" : s.runType === "tempo" || s.runType === "interval";
}

function liftRationale(s: BaseSession, all: BaseSession[]): string {
  const label = focusLabel(s.liftFocus ?? "full-body");
  const first =
    s.variant === "heavy"
      ? `Heavy ${label} session: low reps at a hard effort to build strength.`
      : `${cap(label)} volume session: moderate reps and extra sets to build muscle.`;
  const sameDayRun = all.find((x) => x.type === "run" && x.weekday === s.weekday);
  if (sameDayRun)
    return `${first} Stacked after the ${runName(sameDayRun)} so ${isHard(sameDayRun) ? "the other days stay easy" : "the week fits your time"}.`;
  if (s.heavyLower) {
    const hardRuns = all.filter((x) => x.type === "run" && isHard(x));
    const gaps = hardRuns.map((r) => ({ r, gap: (r.weekday - s.weekday + 7) % 7 })).sort((a, b) => a.gap - b.gap);
    if (gaps.length && gaps[0].gap >= 2)
      return `${first} ${gaps[0].gap} days before ${dayName(gaps[0].r.weekday)}'s ${runName(gaps[0].r)}, so your legs can recover.`;
  }
  return `${first} Placed on ${dayName(s.weekday)} to spread lifting across the week.`;
}

function runRationale(s: BaseSession, all: BaseSession[]): string {
  const sameDayLift = all.find((x) => x.type === "lift" && x.weekday === s.weekday);
  const before = all.filter((x) => x.weekday === prevDay(s.weekday));
  const legsBefore = before.find((x) => x.type === "lift" && x.heavyLower);
  const hardBefore = before.find(isHard);
  if (s.runType === "long") {
    const tail = legsBefore
      ? `It follows ${dayName(legsBefore.weekday)}'s ${liftName(legsBefore)}.`
      : s.weekday >= 6
        ? "A weekend day leaves time to go longer."
        : "No heavy leg lifting the day before.";
    return `Long run on ${dayName(s.weekday)}: builds endurance with a steady, easy effort. ${tail}`;
  }
  if (s.runType === "tempo" || s.runType === "interval") {
    const first =
      s.runType === "tempo"
        ? `Tempo run: ${s.hardMin} min at a comfortably hard effort to raise your threshold.`
        : `Interval run: ${s.hardMin} min of hard reps with easy jogs between to build speed.`;
    const tail = sameDayLift
      ? `Run in the morning, ${liftName(sameDayLift)} later, so the other days stay easy.`
      : legsBefore
        ? `It follows ${dayName(legsBefore.weekday)}'s ${liftName(legsBefore)}; see the plan notes.`
        : "Placed after a day without heavy leg lifting.";
    return `${first} ${tail}`;
  }
  if (hardBefore)
    return `Easy run: placed after ${dayName(hardBefore.weekday)}'s ${hardBefore.type === "lift" ? liftName(hardBefore) : runName(hardBefore)} to keep hard sessions apart.`;
  if (sameDayLift) return `Easy run in the morning before the ${liftName(sameDayLift)}, which keeps the day within your time.`;
  return `Easy aerobic run on ${dayName(s.weekday)}: builds your base without adding stress.`;
}

// Base-week rationale for every session, keyed by session id.
export function describeBase(sessions: BaseSession[]): Map<string, string> {
  return new Map(sessions.map((s) => [s.id, s.type === "lift" ? liftRationale(s, sessions) : runRationale(s, sessions)]));
}

// Replacement rationale for weeks that are not plain build weeks; null = use the base one.
export function kindRationale(kind: WeekKind, type: "run" | "lift"): string | null {
  const lift = type === "lift";
  switch (kind) {
    case "deload":
      return lift
        ? "Deload week: about 60% of the sets at an easy effort so you recover before the next block."
        : "Deload week: running cut to about 60% of last week so you recover.";
    case "race":
      return lift
        ? "Race week: lighter lifting with no heavy legs close to the race."
        : "Race week: trimmed running so you arrive fresh.";
    case "recovery":
      return lift
        ? "Recovery week after the race: light lifting to get moving again."
        : "Recovery week after the race: easy running only.";
    default:
      return null;
  }
}
