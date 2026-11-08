import type { ConflictRule } from "@/lib/types";

function list(items: string[], joiner = "or"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items[items.length - 1]}`;
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function side(type: string | null, runTypes: string[], liftFocus: string[]): string {
  const run = runTypes.length ? `${list(runTypes)} run` : "run";
  const lift = liftFocus.length ? `${list(liftFocus)} lift` : "lift";
  if (type === "run") return `a ${run}`;
  if (type === "lift") return `a ${lift}`;
  if (!runTypes.length && !liftFocus.length) return "any session";
  return `a ${run} or ${lift}`;
}

// One sentence saying when the rule warns, in the user's terms.
export function describeRule(rule: ConflictRule): string {
  const p = rule.params as Record<string, unknown>;
  switch (rule.rule_type) {
    case "min_hours_between":
      return `Warns when ${side(rule.session_type_a, arr(p.a_run_types), arr(p.a_lift_focus))} and ${side(
        rule.session_type_b,
        arr(p.b_run_types),
        arr(p.b_lift_focus),
      )} are less than ${Number(p.hours)}h apart.`;
    case "no_back_to_back_hard": {
      const hard = [
        ...(arr(p.hard_run_types).length ? [`${list(arr(p.hard_run_types))} runs`] : []),
        ...(arr(p.hard_lift_focus).length ? [`${list(arr(p.hard_lift_focus))} lifts`] : []),
      ];
      return `Warns when two hard sessions (${list(hard, "and")}) fall on the same or consecutive days.`;
    }
    case "max_days_without_rest":
      return `Warns after more than ${Number(p.max_days)} training days in a row without a rest day.`;
    case "busy_block_overlap":
      return "Warns when a session with a start time overlaps something on your calendar.";
  }
}
