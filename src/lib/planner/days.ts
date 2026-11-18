// Day selection: which weekdays to train on.

import { dayName, WEEKDAYS, type Budgets } from "./model";
import type { Weekday } from "./types";

export type DayCandidate = { days: Weekday[]; score: number; restUsed: Weekday[] };

function combinations<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  const pick = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i <= items.length - (k - acc.length); i++) {
      acc.push(items[i]);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}

export { combinations };

// Lower score is better: rest-day use dominates, then even spacing, then total time available.
export function scoreDays(days: Weekday[], budgets: Budgets, restDays: Weekday[], longRun: boolean): number {
  const n = days.length;
  const restUsed = days.filter((d) => restDays.includes(d)).length;
  let spread = 0;
  for (let i = 0; i < n; i++) {
    const gap = i + 1 < n ? days[i + 1] - days[i] : days[0] + 7 - days[i];
    spread += (gap - 7 / n) ** 2;
  }
  const minutes = days.reduce((a, d) => a + budgets[d], 0);
  const weekend = longRun && (days.includes(6) || days.includes(7)) ? 1 : 0;
  return 100 * restUsed + spread - minutes / 30 - weekend;
}

export function dayCandidates(
  budgets: Budgets,
  count: number,
  restDays: Weekday[],
  longRun: boolean,
  limit = 12,
): DayCandidate[] {
  const avail = WEEKDAYS.filter((d) => budgets[d] > 0);
  const n = Math.min(count, avail.length);
  if (n === 0) return [];
  return combinations(avail, n)
    .map((days) => ({
      days,
      score: scoreDays(days, budgets, restDays, longRun),
      restUsed: days.filter((d) => restDays.includes(d)),
    }))
    .sort((a, b) => a.score - b.score || a.days.join().localeCompare(b.days.join()))
    .slice(0, limit);
}

export function restDayNote(restUsed: Weekday[]): string {
  return restUsed.map(dayName).join(", ");
}
