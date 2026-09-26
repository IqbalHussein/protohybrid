import { addDays, daysBetween, zonedToUtc, type DateString } from "./dates";

// Rule-based conflict detection (project-spec.md MVP #5). Pure: callers load
// sessions, busy blocks, and the user's conflict_rules rows, and get back a
// list of flags to render. Nothing here is hardcoded beyond the defaults
// offered to a new user — every threshold lives in conflict_rules.params.

export type RunType = "easy" | "tempo" | "long" | "interval" | "race";
export const RUN_TYPES: RunType[] = ["easy", "tempo", "long", "interval", "race"];

export type SessionType = "run" | "lift";

export type RuleType =
  | "min_hours_between"
  | "no_back_to_back_hard"
  | "max_days_without_rest"
  | "busy_block_overlap";

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  min_hours_between: "Minimum hours between two kinds of session",
  no_back_to_back_hard: "No hard sessions on consecutive days",
  max_days_without_rest: "Rest day at least every N days",
  busy_block_overlap: "Session overlaps a calendar commitment",
};

// A session "matches" a side of a rule when its type matches and, if the rule
// narrows it, its run type or lift focus does too. Lift focus is free text, so
// it matches by keyword ("legs" matches "Legs & core").
export type SessionFilter = {
  type: SessionType;
  run_types?: RunType[];
  focus_keywords?: string[];
};

export type RuleParams = {
  min_hours_between: { hours: number; a: SessionFilter; b: SessionFilter };
  no_back_to_back_hard: { hard_run_types: RunType[]; hard_lift_keywords: string[] };
  max_days_without_rest: { days: number };
  busy_block_overlap: { default_minutes: number };
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

export type CalendarSession = {
  id: string;
  type: SessionType;
  date: DateString;
  time: string | null; // HH:MM wall clock, user's timezone
  status: "planned" | "completed" | "skipped";
  adHoc: boolean;
  runType: RunType | null;
  focus: string | null;
  durationMinutes: number | null;
  label: string;
};

export type BusyBlock = { id: string; title: string; start: string; end: string };

export type Conflict = {
  key: string;
  ruleId: string;
  ruleName: string;
  message: string;
  sessionIds: string[];
  date: DateString;
};

export const DEFAULT_RULES: Array<Omit<ConflictRule, "id">> = [
  {
    name: "Heavy legs within 24h of a hard run",
    rule_type: "min_hours_between",
    enabled: true,
    params: {
      hours: 24,
      a: { type: "lift", focus_keywords: ["legs", "leg", "lower", "full body", "full-body", "squat", "deadlift"] },
      b: { type: "run", run_types: ["tempo", "interval", "long", "race"] },
    },
  },
  {
    name: "Hard sessions back to back",
    rule_type: "no_back_to_back_hard",
    enabled: true,
    params: {
      hard_run_types: ["tempo", "interval", "race"],
      hard_lift_keywords: ["legs", "leg", "lower", "full body", "full-body"],
    },
  },
  {
    name: "Rest day at least once a week",
    rule_type: "max_days_without_rest",
    enabled: true,
    params: { days: 6 },
  },
  {
    name: "Session overlaps a calendar commitment",
    rule_type: "busy_block_overlap",
    enabled: true,
    params: { default_minutes: 60 },
  },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function matchesKeywords(focus: string | null, keywords: string[] | undefined): boolean {
  if (!keywords?.length) return true;
  if (!focus) return false;
  const f = norm(focus);
  return keywords.some((k) => norm(k) && f.includes(norm(k)));
}

export function matchesFilter(s: CalendarSession, f: SessionFilter): boolean {
  if (s.type !== f.type) return false;
  if (s.type === "run" && f.run_types?.length) {
    return s.runType != null && f.run_types.includes(s.runType);
  }
  if (s.type === "lift") return matchesKeywords(s.focus, f.focus_keywords);
  return true;
}

// Untimed sessions are treated as midday so "within 24h" still means
// "same day or the next/previous one" for them.
function instantMs(s: CalendarSession, tz: string): number {
  return zonedToUtc(s.date, s.time ?? "12:00", tz).getTime();
}

export function evaluateConflicts(
  sessions: CalendarSession[],
  busy: BusyBlock[],
  rules: ConflictRule[],
  tz: string,
): Conflict[] {
  // Ad-hoc sessions skip conflict checks entirely (starting one is the user
  // knowingly overriding the schedule), and skipped sessions didn't happen.
  const live = sessions
    .filter((s) => !s.adHoc && s.status !== "skipped")
    .sort((a, b) => instantMs(a, tz) - instantMs(b, tz));

  const out: Conflict[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const name = rule.name ?? RULE_TYPE_LABELS[rule.rule_type];
    const push = (sessionIds: string[], date: DateString, message: string) =>
      out.push({
        key: `${rule.id}:${[...sessionIds].sort().join(",")}:${date}`,
        ruleId: rule.id,
        ruleName: name,
        message,
        sessionIds,
        date,
      });

    switch (rule.rule_type) {
      case "min_hours_between": {
        const { hours, a, b } = rule.params;
        const seen = new Set<string>();
        for (const x of live) {
          if (!matchesFilter(x, a)) continue;
          for (const y of live) {
            if (x.id === y.id || !matchesFilter(y, b)) continue;
            const pair = [x.id, y.id].sort().join(",");
            if (seen.has(pair)) continue;
            const gap = Math.abs(instantMs(x, tz) - instantMs(y, tz)) / 3_600_000;
            if (gap < hours) {
              seen.add(pair);
              const [first, second] = x.date <= y.date ? [x, y] : [y, x];
              push(
                [first.id, second.id],
                second.date,
                `${first.label} and ${second.label} are ${Math.round(gap)}h apart (rule: at least ${hours}h).`,
              );
            }
          }
        }
        break;
      }

      case "no_back_to_back_hard": {
        const { hard_run_types, hard_lift_keywords } = rule.params;
        const hard = live.filter((s) =>
          s.type === "run"
            ? s.runType != null && hard_run_types.includes(s.runType)
            : hard_lift_keywords.length > 0 && matchesKeywords(s.focus, hard_lift_keywords),
        );
        for (let i = 0; i < hard.length; i++) {
          for (let j = i + 1; j < hard.length; j++) {
            const d = daysBetween(hard[i].date, hard[j].date);
            if (d > 1) break;
            push(
              [hard[i].id, hard[j].id],
              hard[j].date,
              d === 0
                ? `Two hard sessions on the same day: ${hard[i].label} and ${hard[j].label}.`
                : `Hard sessions on consecutive days: ${hard[i].label}, then ${hard[j].label}.`,
            );
          }
        }
        break;
      }

      case "max_days_without_rest": {
        const { days } = rule.params;
        const byDate = new Map<DateString, CalendarSession[]>();
        for (const s of live) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
        const dates = [...byDate.keys()].sort();
        let streakStart: DateString | null = null;
        let prev: DateString | null = null;
        for (const d of dates) {
          streakStart = prev && daysBetween(prev, d) === 1 ? streakStart : d;
          prev = d;
          const length = daysBetween(streakStart!, d) + 1;
          // Flag the day that breaks the limit, once per streak.
          if (length === days + 1) {
            push(
              byDate.get(d)!.map((s) => s.id),
              d,
              `${length} training days in a row without rest (rule: rest at least every ${days + 1} days).`,
            );
          }
        }
        break;
      }

      case "busy_block_overlap": {
        const { default_minutes } = rule.params;
        for (const s of live) {
          if (!s.time) continue;
          const start = instantMs(s, tz);
          const end = start + (s.durationMinutes ?? default_minutes) * 60_000;
          for (const b of busy) {
            const bs = new Date(b.start).getTime();
            const be = new Date(b.end).getTime();
            if (start < be && bs < end) {
              push([s.id], s.date, `${s.label} overlaps “${b.title}”.`);
            }
          }
        }
        break;
      }
    }
  }
  return out;
}

// The window of sessions a week's conflicts depend on: rest-day streaks can
// reach back up to the longest configured streak, hour rules a day or so.
export function lookbackDays(rules: ConflictRule[]): number {
  let days = 2;
  for (const r of rules) {
    if (!r.enabled) continue;
    if (r.rule_type === "max_days_without_rest") days = Math.max(days, r.params.days + 1);
    if (r.rule_type === "min_hours_between") days = Math.max(days, Math.ceil(r.params.hours / 24) + 1);
  }
  return days;
}

export function conflictWindow(monday: DateString, rules: ConflictRule[]) {
  const pad = lookbackDays(rules);
  return { from: addDays(monday, -pad), to: addDays(monday, 6 + pad) };
}
