import type { BusyBlock, CalendarSession } from "./types";

/**
 * The conflict-warning surface, reserved and deliberately empty.
 *
 * The weekly-calendar spec defines *where* warnings render — a badge on a
 * session card and a line above the week — but the rules that populate them
 * are a separate feature (MVP #5), driven by the user-configurable
 * `conflict_rules` table that has existed since 0001 and is still unused.
 *
 * This exists as a real call site so the grid renders nothing today and needs
 * no surgery when the rule engine lands: fill these in, and the badges appear.
 */

export type Conflict = {
  sessionId: string;
  /** One short line, e.g. "Heavy legs 14h after a tempo run". */
  message: string;
};

export function findConflicts(
  _sessions: CalendarSession[],
  _busyBlocks: BusyBlock[],
): Conflict[] {
  return [];
}

/** The conflicts attached to one session, for its card's badge. */
export function conflictsFor(conflicts: Conflict[], sessionId: string): Conflict[] {
  return conflicts.filter((c) => c.sessionId === sessionId);
}
