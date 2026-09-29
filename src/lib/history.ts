/**
 * Lifts and runs as one newest-first history.
 *
 * Each kind is fetched with its own limit. If one list hit its limit, it may
 * be missing entries older than its last row, and merging past that point
 * would show the other kind's older entries with gaps in between — a week of
 * runs and no lifts, when the lifts just weren't fetched. So the merged list
 * stops at the newest date either truncated list can vouch for.
 */

export type Dated = { date: string };

export function mergeHistory<L extends Dated, R extends Dated>(
  lifts: L[],
  runs: R[],
  limit: number,
): { entries: ({ kind: "lift"; item: L } | { kind: "run"; item: R })[]; complete: boolean; since: string | null } {
  // Only a list that came back full can be missing anything.
  const cutoffs = [lifts.length >= limit ? lifts.at(-1)!.date : null, runs.length >= limit ? runs.at(-1)!.date : null]
    .filter((d): d is string => d != null);
  const since = cutoffs.length ? cutoffs.sort().at(-1)! : null;

  const entries = [
    ...lifts.map((item) => ({ kind: "lift" as const, item })),
    ...runs.map((item) => ({ kind: "run" as const, item })),
  ]
    .filter((e) => since == null || e.item.date >= since)
    .sort((a, b) => b.item.date.localeCompare(a.item.date));

  return { entries, complete: since == null, since };
}
