import { describe, expect, it } from "vitest";
import type { ConflictRule } from "@/lib/types";
import { describeRule } from "./conflict-rules-describe";

const rule = (r: Partial<ConflictRule>): ConflictRule =>
  ({ id: "r", user_id: "u", name: null, enabled: true, session_type_a: null, session_type_b: null, params: {}, ...r }) as ConflictRule;

describe("describeRule", () => {
  it("describes the default lift-before-hard-run gap", () => {
    expect(
      describeRule(
        rule({
          rule_type: "min_hours_between",
          session_type_a: "lift",
          session_type_b: "run",
          params: { hours: 24, a_run_types: [], a_lift_focus: ["legs", "lower", "full-body"], b_run_types: ["tempo", "interval"], b_lift_focus: [] },
        }),
      ),
    ).toBe("Warns when a legs, lower or full-body lift and a tempo or interval run are less than 24h apart.");
  });

  it("says any session when a side has no type or filters", () => {
    expect(describeRule(rule({ rule_type: "min_hours_between", params: { hours: 12 } }))).toBe(
      "Warns when any session and any session are less than 12h apart.",
    );
  });

  it("lists hard sessions for back-to-back", () => {
    expect(
      describeRule(rule({ rule_type: "no_back_to_back_hard", params: { hard_run_types: ["tempo", "race"], hard_lift_focus: ["legs"] } })),
    ).toBe("Warns when two hard sessions (tempo or race runs and legs lifts) fall on the same or consecutive days.");
  });

  it("describes rest days and busy overlap", () => {
    expect(describeRule(rule({ rule_type: "max_days_without_rest", params: { max_days: 6 } }))).toBe(
      "Warns after more than 6 training days in a row without a rest day.",
    );
    expect(describeRule(rule({ rule_type: "busy_block_overlap" }))).toBe(
      "Warns when a session with a start time overlaps something on your calendar.",
    );
  });

  it("ignores malformed params instead of crashing", () => {
    expect(describeRule(rule({ rule_type: "no_back_to_back_hard", params: { hard_run_types: "tempo", hard_lift_focus: [1, "legs"] } as never }))).toBe(
      "Warns when two hard sessions (legs lifts) fall on the same or consecutive days.",
    );
  });
});
