import { countsAsWork } from "./math";
import type { SetType } from "./types";

/**
 * An exercise's place in the workout. `supersetGroup` is the uuid shared by
 * every set in the same superset (lift_sets.superset_group); null means the
 * exercise is on its own.
 *
 * Order matters: the list is expected in workout order (the order exercises
 * were first logged), which is what defines a group's "last" member.
 */
export type GroupedExercise = {
  exerciseId: string;
  supersetGroup: string | null;
};

/** The exercise ids in one superset group, in workout order. */
export function supersetMembers(
  exercises: GroupedExercise[],
  group: string | null,
): string[] {
  if (!group) return [];
  return exercises.filter((e) => e.supersetGroup === group).map((e) => e.exerciseId);
}

/**
 * Whether logging this set should start the rest timer.
 *
 * Two rules, both from the spec:
 *   - only a working set rests (warm-ups run straight into the next set);
 *   - inside a superset, rest comes only after the group's last exercise, so
 *     the pair is logged back-to-back.
 *
 * A group with a single member is not a superset in any meaningful sense —
 * that member is also its last, so it rests normally.
 */
export function shouldStartRest(
  setType: SetType,
  exerciseId: string,
  exercises: GroupedExercise[],
): boolean {
  if (!countsAsWork(setType)) return false;

  const self = exercises.find((e) => e.exerciseId === exerciseId);
  if (!self?.supersetGroup) return true;

  const members = supersetMembers(exercises, self.supersetGroup);
  return members[members.length - 1] === exerciseId;
}

/**
 * Stable display letters for each superset group in a workout — A, B, C… in
 * the order the groups first appear. Letters are per-workout labels only; the
 * uuid stays the identity.
 */
export function supersetLabels(exercises: GroupedExercise[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const e of exercises) {
    if (!e.supersetGroup || labels.has(e.supersetGroup)) continue;
    labels.set(e.supersetGroup, String.fromCharCode(65 + labels.size));
  }
  return labels;
}
