import { minutesToTimeString, zonedToUtc } from "@/lib/time";
import { addDays, daysBetween, formatDayHeading } from "@/lib/week";
import type { SessionType } from "@/lib/types";
import {
  ASSUMED_DURATION_MIN,
  RUN_TYPE_LABELS,
  type BusyBlock,
  type CalendarSession,
  type RunType,
} from "./types";

/**
 * Rule-based conflict detection (project-spec.md MVP #5).
 *
 * Pure: the caller loads sessions, busy blocks and the user's `conflict_rules`
 * rows, and gets back flags for the grid's two warning surfaces — a badge on
 * each involved card and a line above the week. Nothing is hardcoded beyond
 * the defaults a new user starts with; every threshold lives in
 * `conflict_rules.params`, which is what "user-configurable from the start"
 * asks for.
 */

export type RuleType =
  | "min_hours_between"
  | "no_back_to_back_hard"
  | "max_days_without_rest"
  | "busy_block_overlap";

export const RULE_TYPES: RuleType[] = [
  "min_hours_between",
  "no_back_to_back_hard",
  "max_days_without_rest",
  "busy_block_overlap",
];

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  min_hours_between: "Minimum hours between two kinds of session",
  no_back_to_back_hard: "No hard sessions on consecutive days",
  max_days_without_rest: "Rest day at least every N days",
  busy_block_overlap: "Session overlaps a commitment",
};

/**
 * One side of a min-hours rule. A session matches when its type does and, if
 * the filter narrows it, its run type or lift focus does too. Lift focus is
 * free text, so it matches by keyword: "legs" matches "Legs & core".
 */
export type SessionFilter = {
  type: SessionType;
  run_types?: RunType[];
  focus_keywords?: string[];
};

export type RuleParams = {
  min_hours_between: { hours: number; a: SessionFilter; b: SessionFilter };
  no_back_to_back_hard: { hard_run_types: RunType[]; hard_lift_keywords: string[] };
  max_days_without_rest: { days: number };
  // Nothing to configure: an untimed session can't overlap anything, and a
  // timed one without a duration is assumed to last as long as the grid
  // draws it.
  busy_block_overlap: Record<string, never>;
};

export type ConflictRule = {
  [K in RuleType]: {
    id: string;
    name: string | null;
    rule_type: K;
    params: RuleParams[K];
    enabled: boolean;
  };
}[RuleType];

export type Conflict = {
  /** Stable across renders, for React keys and de-duplication. */
  key: string;
  ruleId: string;
  /** One short line, e.g. "Legs (Tue 15) is 14h before Tempo run (Wed 16) — rule: 24h apart". */
  message: string;
  sessionIds: string[];
};

const LEG_KEYWORDS = ["legs", "leg", "lower", "full body", "squat", "deadlift"];

/** What a new user starts with, seeded once (see `user_settings.conflict_rules_seeded`). */
export const DEFAULT_RULES: Omit<ConflictRule, "id">[] = [
  {
    name: "Heavy legs within 24h of a hard run",
    rule_type: "min_hours_between",
    enabled: true,
    params: {
      hours: 24,
      a: { type: "lift", focus_keywords: LEG_KEYWORDS },
      b: { type: "run", run_types: ["tempo", "interval", "long", "race"] },
    },
  },
  {
    name: "Hard sessions back to back",
    rule_type: "no_back_to_back_hard",
    enabled: true,
    params: {
      hard_run_types: ["tempo", "interval", "race"],
      hard_lift_keywords: ["legs", "leg", "lower", "full body"],
    },
  },
  {
    name: "Rest day at least once a week",
    rule_type: "max_days_without_rest",
    enabled: true,
    params: { days: 6 },
  },
  {
    name: "Session overlaps a commitment",
    rule_type: "busy_block_overlap",
    enabled: true,
    params: {},
  },
];

/** Case and punctuation don't matter: "full-body", "Full body" and "fullbody" are one keyword. */
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function matchesKeywords(focus: string | null | undefined, keywords: string[] | undefined): boolean {
  if (!keywords?.length) return true;
  if (!focus) return false;
  const f = normalize(focus);
  return keywords.some((k) => normalize(k) !== "" && f.includes(normalize(k)));
}

export function matchesFilter(session: CalendarSession, filter: SessionFilter): boolean {
  if (session.type !== filter.type) return false;
  if (session.type === "run") {
    if (!filter.run_types?.length) return true;
    const runType = session.run?.run_type;
    return runType != null && filter.run_types.includes(runType);
  }
  return matchesKeywords(session.lift?.focus, filter.focus_keywords);
}

function isHard(session: CalendarSession, params: RuleParams["no_back_to_back_hard"]): boolean {
  if (session.type === "run") {
    const runType = session.run?.run_type;
    return runType != null && params.hard_run_types.includes(runType);
  }
  // An empty keyword list means "no lift counts as hard", not "every lift does".
  return params.hard_lift_keywords.length > 0 && matchesKeywords(session.lift?.focus, params.hard_lift_keywords);
}

/**
 * When a session happens, as an instant. An untimed session is treated as
 * midday, so "within 24h" still means "the same day or an adjacent one" for
 * the "anytime that day" cards that most planning starts with.
 */
function instantMs(session: CalendarSession): number {
  return zonedToUtc(session.plannedDate, minutesToTimeString(session.startMin ?? 12 * 60)).getTime();
}

/** "Tempo run (Wed 16)" — enough to find the card the message is about. */
function describe(session: CalendarSession): string {
  const title =
    session.type === "run"
      ? session.run
        ? `${RUN_TYPE_LABELS[session.run.run_type]} run`
        : "Run"
      : session.lift?.focus ?? "Lift";
  return `${title} (${formatDayHeading(session.plannedDate)})`;
}

export function findConflicts(
  sessions: CalendarSession[],
  busyBlocks: BusyBlock[],
  rules: ConflictRule[],
): Conflict[] {
  // Ad-hoc sessions skip conflict checks entirely, per the lift-logger spec,
  // and a skipped session didn't happen, so it can't be too close to anything.
  const live = sessions
    .filter((s) => !s.adHoc && s.status !== "skipped")
    .sort((a, b) => instantMs(a) - instantMs(b));

  const out: Conflict[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const flag = (sessionIds: string[], message: string) =>
      out.push({ key: `${rule.id}:${sessionIds.join(",")}`, ruleId: rule.id, message, sessionIds });

    switch (rule.rule_type) {
      case "min_hours_between": {
        const { hours, a, b } = rule.params;
        const seen = new Set<string>();
        for (const x of live) {
          if (!matchesFilter(x, a)) continue;
          for (const y of live) {
            if (x.id === y.id || !matchesFilter(y, b)) continue;
            // `live` is chronological, so this pair's order is fixed and a rule
            // whose two sides overlap still reports each pair once.
            const [first, second] = instantMs(x) <= instantMs(y) ? [x, y] : [y, x];
            const pair = `${first.id},${second.id}`;
            if (seen.has(pair)) continue;
            const gap = (instantMs(second) - instantMs(first)) / 3_600_000;
            if (gap < hours) {
              seen.add(pair);
              flag(
                [first.id, second.id],
                `${describe(first)} is ${Math.round(gap)}h before ${describe(second)} — rule: ${hours}h apart`,
              );
            }
          }
        }
        break;
      }

      case "no_back_to_back_hard": {
        const hard = live.filter((s) => isHard(s, rule.params));
        for (let i = 0; i < hard.length; i++) {
          for (let j = i + 1; j < hard.length; j++) {
            const days = daysBetween(hard[i].plannedDate, hard[j].plannedDate);
            if (days > 1) break;
            flag(
              [hard[i].id, hard[j].id],
              days === 0
                ? `Two hard sessions on one day: ${describe(hard[i])} and ${describe(hard[j])}`
                : `Hard sessions back to back: ${describe(hard[i])}, then ${describe(hard[j])}`,
            );
          }
        }
        break;
      }

      case "max_days_without_rest": {
        const { days } = rule.params;
        const byDate = new Map<string, string[]>();
        for (const s of live) byDate.set(s.plannedDate, [...(byDate.get(s.plannedDate) ?? []), s.id]);

        let streakStart: string | null = null;
        let previous: string | null = null;
        for (const date of [...byDate.keys()].sort()) {
          streakStart = previous && daysBetween(previous, date) === 1 ? streakStart : date;
          previous = date;
          // Flag the day that breaks the limit, once per streak, rather than
          // every day after it.
          const length = daysBetween(streakStart!, date) + 1;
          if (length === days + 1) {
            flag(
              byDate.get(date)!,
              `${length} training days in a row by ${formatDayHeading(date)} — rule: rest at least every ${days + 1} days`,
            );
          }
        }
        break;
      }

      case "busy_block_overlap": {
        for (const s of live) {
          if (s.startMin == null) continue;
          const start = instantMs(s);
          const end = start + (s.durationMin ?? ASSUMED_DURATION_MIN) * 60_000;
          for (const block of busyBlocks) {
            if (start < new Date(block.endTime).getTime() && new Date(block.startTime).getTime() < end) {
              flag([s.id], `${describe(s)} overlaps “${block.title}”`);
            }
          }
        }
        break;
      }
    }
  }

  return out;
}

/** The conflicts attached to one session, for its card's badge. */
export function conflictsFor(conflicts: Conflict[], sessionId: string): Conflict[] {
  return conflicts.filter((c) => c.sessionIds.includes(sessionId));
}

/**
 * The dates a week's conflicts depend on. A rest-day streak that breaks on
 * Monday started up to N days earlier, and a min-hours rule reaches a day or
 * more past either edge, so a week can't be checked by looking only at itself.
 * Returns [from, to) as YYYY-MM-DD.
 */
export function conflictWindow(weekStart: string, rules: ConflictRule[]): { from: string; to: string } {
  let pad = 1;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.rule_type === "max_days_without_rest") pad = Math.max(pad, rule.params.days);
    if (rule.rule_type === "min_hours_between") pad = Math.max(pad, Math.ceil(rule.params.hours / 24));
  }
  return { from: addDays(weekStart, -pad), to: addDays(weekStart, 7 + pad) };
}
