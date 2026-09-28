import { saveConflictRule } from "@/app/settings/actions";
import {
  RULE_TYPE_LABELS,
  type ConflictRule,
  type RuleParams,
  type RuleType,
  type SessionFilter,
} from "@/lib/calendar/conflicts";
import { RUN_TYPES, RUN_TYPE_LABELS } from "@/lib/calendar/types";

/**
 * Create or edit one conflict rule. Which fields show depends on the rule
 * type; `saveConflictRule` parses them back into `conflict_rules.params`.
 * Server-rendered like the rest of the forms: no client state.
 */

const input = "rounded border border-neutral-300 px-2 py-1.5 text-base";

/** What a new rule of each type starts with. */
const NEW_RULE_PARAMS: RuleParams = {
  min_hours_between: {
    hours: 24,
    a: { type: "lift", focus_keywords: ["legs"] },
    b: { type: "run", run_types: ["tempo", "interval"] },
  },
  no_back_to_back_hard: { hard_run_types: ["tempo", "interval", "race"], hard_lift_keywords: ["legs"] },
  max_days_without_rest: { days: 6 },
  busy_block_overlap: {},
};

function RunTypeChecks({ name, selected }: { name: string; selected: string[] }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {RUN_TYPES.map((t) => (
        <label key={t} className="flex items-center gap-1">
          <input type="checkbox" name={name} value={t} defaultChecked={selected.includes(t)} />
          {RUN_TYPE_LABELS[t]}
        </label>
      ))}
    </span>
  );
}

function FilterFields({ side, filter }: { side: "a" | "b"; filter: SessionFilter }) {
  return (
    <fieldset className="flex flex-col gap-1.5 rounded border border-neutral-200 p-2">
      <legend className="px-1 text-xs text-neutral-500">{side === "a" ? "First session" : "Second session"}</legend>
      <label className="flex items-center gap-2">
        Type
        <select name={`${side}_type`} defaultValue={filter.type} className={input}>
          <option value="lift">Lift</option>
          <option value="run">Run</option>
        </select>
      </label>
      <span className="text-xs text-neutral-500">If a run, which kinds (none ticked = any run):</span>
      <RunTypeChecks name={`${side}_run_types`} selected={filter.run_types ?? []} />
      <label className="flex flex-col gap-0.5">
        <span className="text-xs text-neutral-500">If a lift, focus keywords, comma-separated (blank = any lift):</span>
        <input name={`${side}_keywords`} defaultValue={(filter.focus_keywords ?? []).join(", ")} className={input} />
      </label>
    </fieldset>
  );
}

export default function RuleForm({ rule, ruleType }: { rule?: ConflictRule; ruleType: RuleType }) {
  const params = rule?.params ?? NEW_RULE_PARAMS[ruleType];

  return (
    <form action={saveConflictRule} className="flex flex-col gap-2 text-sm">
      {rule ? <input type="hidden" name="ruleId" value={rule.id} /> : null}
      <input type="hidden" name="ruleType" value={ruleType} />

      <label className="flex flex-col gap-0.5">
        <span className="text-xs text-neutral-500">Name</span>
        <input name="name" defaultValue={rule?.name ?? RULE_TYPE_LABELS[ruleType]} className={input} />
      </label>

      {ruleType === "min_hours_between" ? (
        <MinHoursFields params={params as RuleParams["min_hours_between"]} />
      ) : null}

      {ruleType === "no_back_to_back_hard" ? (
        <>
          <span className="text-xs text-neutral-500">Runs that count as hard:</span>
          <RunTypeChecks
            name="hard_run_types"
            selected={(params as RuleParams["no_back_to_back_hard"]).hard_run_types}
          />
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-neutral-500">
              Lifts that count as hard, by focus keyword, comma-separated (blank = none):
            </span>
            <input
              name="hard_lift_keywords"
              defaultValue={(params as RuleParams["no_back_to_back_hard"]).hard_lift_keywords.join(", ")}
              className={input}
            />
          </label>
        </>
      ) : null}

      {ruleType === "max_days_without_rest" ? (
        <label className="flex flex-wrap items-center gap-2">
          Flag after
          <input
            name="days"
            inputMode="numeric"
            defaultValue={(params as RuleParams["max_days_without_rest"]).days}
            className={`${input} w-16`}
          />
          training days in a row
        </label>
      ) : null}

      {ruleType === "busy_block_overlap" ? (
        <p className="text-xs text-neutral-500">
          Flags a timed session that overlaps a commitment. Sessions without a planned duration count as an hour, the
          same as the calendar draws them.
        </p>
      ) : null}

      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? true} />
        On
      </label>
      <button className="self-start rounded bg-neutral-900 px-3 py-1.5 text-white">
        {rule ? "Save rule" : "Add rule"}
      </button>
    </form>
  );
}

function MinHoursFields({ params }: { params: RuleParams["min_hours_between"] }) {
  return (
    <>
      <label className="flex flex-wrap items-center gap-2">
        Flag when fewer than
        <input name="hours" inputMode="numeric" defaultValue={params.hours} className={`${input} w-20`} />
        hours apart:
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <FilterFields side="a" filter={params.a} />
        <FilterFields side="b" filter={params.b} />
      </div>
    </>
  );
}
