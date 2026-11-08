// Rule-based conflict detection over planned and completed sessions.
// Pure: no I/O. Inputs are already in the user's local time.
//
// Timeline model: each session occupies [start, start + duration) minutes on a
// continuous timeline. A missing start time counts as 12:00 and a missing
// duration as 60 minutes. Skipped sessions are ignored everywhere.

import type { ConflictRule, ConflictRuleType, RunType, SessionStatus, SessionType } from "./types";
import { diffDays, formatDateLabel, formatTime } from "./time";

export const DEFAULT_START_MIN = 12 * 60;
export const DEFAULT_DURATION_MIN = 60;

export type ConflictSession = {
  id: string;
  type: SessionType;
  status: SessionStatus;
  date: string; // YYYY-MM-DD, local
  startMin: number | null; // minutes after local midnight
  durationMin: number | null;
  runType: RunType | null;
  liftFocus: string | null;
};

// A busy block piece within a single local day.
export type ConflictBusy = {
  id: string;
  title: string;
  date: string;
  startMin: number;
  endMin: number; // exclusive, up to 1440
};

export type Conflict = {
  ruleId: string;
  ruleName: string;
  ruleType: ConflictRuleType;
  sessionIds: string[];
  dates: string[];
  message: string;
};

export const DEFAULT_RULE_NAMES: Record<ConflictRuleType, string> = {
  min_hours_between: "Minimum gap between sessions",
  no_back_to_back_hard: "No back-to-back hard days",
  max_days_without_rest: "Regular rest days",
  busy_block_overlap: "Overlaps a busy block",
};

const EPOCH = "2000-01-01";

function span(s: ConflictSession): { start: number; end: number } {
  const start = diffDays(EPOCH, s.date) * 1440 + (s.startMin ?? DEFAULT_START_MIN);
  return { start, end: start + Math.max(0, s.durationMin ?? DEFAULT_DURATION_MIN) };
}

// Minutes from the end of the earlier session to the start of the later one.
// Zero or negative means they touch or overlap.
export function gapMinutes(a: ConflictSession, b: ConflictSession): number {
  const sa = span(a);
  const sb = span(b);
  const [first, second] = sa.start <= sb.start ? [sa, sb] : [sb, sa];
  return second.start - first.end;
}

function lower(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function sessionLabel(s: ConflictSession): string {
  if (s.type === "run") return `${s.runType ?? "planned"} run`;
  return `${s.liftFocus?.trim() || "planned"} lift`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function formatHours(minutes: number): string {
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h}h`;
}

function matchesSide(
  s: ConflictSession,
  type: SessionType | null | undefined,
  runTypes: string[],
  liftFocus: string[],
): boolean {
  if (type && s.type !== type) return false;
  if (s.type === "run" && runTypes.length > 0 && !runTypes.includes(s.runType ?? "")) return false;
  if (s.type === "lift" && liftFocus.length > 0 && !liftFocus.map(lower).includes(lower(s.liftFocus))) return false;
  return true;
}

function ordered(a: ConflictSession, b: ConflictSession): [ConflictSession, ConflictSession] {
  return span(a).start <= span(b).start ? [a, b] : [b, a];
}

function uniqueDates(sessions: ConflictSession[]): string[] {
  return [...new Set(sessions.map((s) => s.date))].sort();
}

function minHoursBetween(rule: Extract<ConflictRule, { rule_type: "min_hours_between" }>, sessions: ConflictSession[], name: string): Conflict[] {
  const hours = Number(rule.params?.hours);
  if (!Number.isFinite(hours) || hours <= 0) return [];
  const limit = hours * 60;
  const aRun = strings(rule.params?.a_run_types);
  const aLift = strings(rule.params?.a_lift_focus);
  const bRun = strings(rule.params?.b_run_types);
  const bLift = strings(rule.params?.b_lift_focus);

  const seen = new Set<string>();
  const out: Conflict[] = [];
  for (const x of sessions) {
    if (!matchesSide(x, rule.session_type_a, aRun, aLift)) continue;
    for (const y of sessions) {
      if (x.id === y.id) continue;
      if (!matchesSide(y, rule.session_type_b, bRun, bLift)) continue;
      const key = pairKey(x.id, y.id);
      if (seen.has(key)) continue;
      const gap = gapMinutes(x, y);
      if (gap >= limit) continue;
      seen.add(key);
      const [first, second] = ordered(x, y);
      const distance = gap <= 0 ? "they overlap" : `${formatHours(gap)} apart`;
      out.push({
        ruleId: rule.id,
        ruleName: name,
        ruleType: rule.rule_type,
        sessionIds: [first.id, second.id],
        dates: uniqueDates([first, second]),
        message: `${name}: ${sessionLabel(first)} and ${sessionLabel(second)} are ${distance}, rule asks for ${hours}h.`,
      });
    }
  }
  return out;
}

function noBackToBackHard(rule: Extract<ConflictRule, { rule_type: "no_back_to_back_hard" }>, sessions: ConflictSession[], name: string): Conflict[] {
  const hardRun = strings(rule.params?.hard_run_types);
  const hardLift = strings(rule.params?.hard_lift_focus).map(lower);
  const isHard = (s: ConflictSession) =>
    s.type === "run" ? hardRun.includes(s.runType ?? "") : hardLift.includes(lower(s.liftFocus));
  const hard = sessions.filter(isHard);

  const out: Conflict[] = [];
  for (let i = 0; i < hard.length; i++) {
    for (let j = i + 1; j < hard.length; j++) {
      const days = Math.abs(diffDays(hard[i].date, hard[j].date));
      if (days > 1) continue;
      const [first, second] = ordered(hard[i], hard[j]);
      const when =
        days === 0
          ? `are both on ${formatDateLabel(first.date)}`
          : `are on back-to-back days (${formatDateLabel(first.date)} and ${formatDateLabel(second.date)})`;
      out.push({
        ruleId: rule.id,
        ruleName: name,
        ruleType: rule.rule_type,
        sessionIds: [first.id, second.id],
        dates: uniqueDates([first, second]),
        message: `${name}: hard ${sessionLabel(first)} and hard ${sessionLabel(second)} ${when}.`,
      });
    }
  }
  return out;
}

function maxDaysWithoutRest(rule: Extract<ConflictRule, { rule_type: "max_days_without_rest" }>, sessions: ConflictSession[], name: string): Conflict[] {
  const maxDays = Number(rule.params?.max_days);
  if (!Number.isFinite(maxDays) || maxDays < 1) return [];
  const byDate = new Map<string, string[]>();
  for (const s of sessions) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s.id]);
  const dates = [...byDate.keys()].sort();

  const out: Conflict[] = [];
  let streak: string[] = [];
  const flush = () => {
    if (streak.length > maxDays) {
      out.push({
        ruleId: rule.id,
        ruleName: name,
        ruleType: rule.rule_type,
        sessionIds: streak.flatMap((d) => byDate.get(d) ?? []),
        dates: [...streak],
        message: `${name}: ${streak.length} training days in a row (${formatDateLabel(streak[0])} to ${formatDateLabel(
          streak[streak.length - 1],
        )}), rule allows ${maxDays}.`,
      });
    }
  };
  for (const d of dates) {
    if (streak.length > 0 && diffDays(streak[streak.length - 1], d) === 1) streak.push(d);
    else {
      flush();
      streak = [d];
    }
  }
  flush();
  return out;
}

function busyBlockOverlap(rule: Extract<ConflictRule, { rule_type: "busy_block_overlap" }>, sessions: ConflictSession[], busy: ConflictBusy[], name: string): Conflict[] {
  const out: Conflict[] = [];
  for (const s of sessions) {
    if (s.startMin === null) continue;
    const start = s.startMin;
    const end = start + Math.max(0, s.durationMin ?? DEFAULT_DURATION_MIN);
    for (const b of busy) {
      if (b.date !== s.date) continue;
      if (!(start < b.endMin && b.startMin < end)) continue;
      out.push({
        ruleId: rule.id,
        ruleName: name,
        ruleType: rule.rule_type,
        sessionIds: [s.id],
        dates: [s.date],
        message: `${name}: ${sessionLabel(s)} at ${formatTime(start)} overlaps "${b.title}" (${formatTime(b.startMin)}–${formatTime(
          Math.min(b.endMin, 1439),
        )}).`,
      });
    }
  }
  return out;
}

export function detectConflicts(sessions: ConflictSession[], busy: ConflictBusy[], rules: ConflictRule[]): Conflict[] {
  const active = sessions.filter((s) => s.status !== "skipped");
  const out: Conflict[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const name = rule.name?.trim() || DEFAULT_RULE_NAMES[rule.rule_type] || "Conflict";
    switch (rule.rule_type) {
      case "min_hours_between":
        out.push(...minHoursBetween(rule, active, name));
        break;
      case "no_back_to_back_hard":
        out.push(...noBackToBackHard(rule, active, name));
        break;
      case "max_days_without_rest":
        out.push(...maxDaysWithoutRest(rule, active, name));
        break;
      case "busy_block_overlap":
        out.push(...busyBlockOverlap(rule, active, busy, name));
        break;
    }
  }
  return out.map((c) => ({ ...c, message: capitalize(c.message) }));
}

export function conflictsBySession(conflicts: Conflict[]): Map<string, Conflict[]> {
  const map = new Map<string, Conflict[]>();
  for (const c of conflicts) {
    for (const id of c.sessionIds) map.set(id, [...(map.get(id) ?? []), c]);
  }
  return map;
}

export function conflictsByDate(conflicts: Conflict[]): Map<string, Conflict[]> {
  const map = new Map<string, Conflict[]>();
  for (const c of conflicts) {
    for (const d of c.dates) map.set(d, [...(map.get(d) ?? []), c]);
  }
  return map;
}

// Conflicts that touch any of the given dates.
export function conflictsTouching(conflicts: Conflict[], dates: string[]): Conflict[] {
  const set = new Set(dates);
  return conflicts.filter((c) => c.dates.some((d) => set.has(d)));
}
