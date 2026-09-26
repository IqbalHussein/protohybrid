import { RULE_TYPE_LABELS, RUN_TYPES, type ConflictRule, type RuleParams, type RuleType, type SessionFilter } from "@/lib/conflicts";
import { saveConflictRule } from "@/app/settings/actions";

const input = "rounded border border-neutral-300 px-2 py-1.5 text-base";

const DEFAULT_PARAMS: RuleParams = {
  min_hours_between: { hours: 24, a: { type: "lift", focus_keywords: ["legs"] }, b: { type: "run", run_types: ["tempo", "interval"] } },
  no_back_to_back_hard: { hard_run_types: ["tempo", "interval", "race"], hard_lift_keywords: ["legs"] },
  max_days_without_rest: { days: 6 },
  busy_block_overlap: { default_minutes: 60 },
};

function RunTypeChecks({ name, selected }: { name: string; selected: string[] }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {RUN_TYPES.map((t) => (
        <label key={t} className="flex items-center gap-1">
          <input type="checkbox" name={name} value={t} defaultChecked={selected.includes(t)} />
          {t}
        </label>
      ))}
    </span>
  );
}

function FilterFields({ side, filter }: { side: "a" | "b"; filter: SessionFilter }) {
  return (
    <fieldset className="flex flex-col gap-1.5 rounded border border-neutral-200 p-2">
      <legend className="px-1 text-xs text-neutral-500">Session {side.toUpperCase()}</legend>
      <label className="flex items-center gap-2">
        Type
        <select name={`${side}_type`} defaultValue={filter.type} className={input}>
          <option value="lift">lift</option>
          <option value="run">run</option>
        </select>
      </label>
      <span className="text-xs text-neutral-500">If a run — which run types (none = any):</span>
      <RunTypeChecks name={`${side}_run_types`} selected={filter.run_types ?? []} />
      <label className="flex flex-col gap-0.5">
        <span className="text-xs text-neutral-500">If a lift — focus keywords, comma-separated (blank = any):</span>
        <input name={`${side}_keywords`} defaultValue={(filter.focus_keywords ?? []).join(", ")} className={input} />
      </label>
    </fieldset>
  );
}

// Create/edit form for one conflict rule. The fields depend on the rule type;
// the matching server action parses them back into conflict_rules.params.
export function RuleForm({ rule, ruleType }: { rule?: ConflictRule; ruleType: RuleType }) {
  const params = (rule?.params ?? DEFAULT_PARAMS[ruleType]) as RuleParams[RuleType];
  return (
    <form action={saveConflictRule} className="flex flex-col gap-2 text-sm">
      {rule ? <input type="hidden" name="ruleId" value={rule.id} /> : null}
      <input type="hidden" name="ruleType" value={ruleType} />
      <label className="flex flex-col gap-0.5">
        <span className="text-xs text-neutral-500">Name</span>
        <input name="name" defaultValue={rule?.name ?? RULE_TYPE_LABELS[ruleType]} className={input} />
      </label>

      {ruleType === "min_hours_between" ? (
        <>
          <label className="flex items-center gap-2">
            Flag when fewer than
            <input name="hours" inputMode="numeric" defaultValue={(params as RuleParams["min_hours_between"]).hours} className={`${input} w-20`} />
            hours apart:
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <FilterFields side="a" filter={(params as RuleParams["min_hours_between"]).a} />
            <FilterFields side="b" filter={(params as RuleParams["min_hours_between"]).b} />
          </div>
        </>
      ) : null}

      {ruleType === "no_back_to_back_hard" ? (
        <>
          <span className="text-xs text-neutral-500">Hard run types:</span>
          <RunTypeChecks name="hard_run_types" selected={(params as RuleParams["no_back_to_back_hard"]).hard_run_types} />
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-neutral-500">Hard lift focus keywords, comma-separated:</span>
            <input
              name="hard_lift_keywords"
              defaultValue={(params as RuleParams["no_back_to_back_hard"]).hard_lift_keywords.join(", ")}
              className={input}
            />
          </label>
        </>
      ) : null}

      {ruleType === "max_days_without_rest" ? (
        <label className="flex items-center gap-2">
          Flag after
          <input name="days" inputMode="numeric" defaultValue={(params as RuleParams["max_days_without_rest"]).days} className={`${input} w-16`} />
          training days in a row
        </label>
      ) : null}

      {ruleType === "busy_block_overlap" ? (
        <label className="flex items-center gap-2">
          Assume sessions without a planned duration last
          <input
            name="default_minutes"
            inputMode="numeric"
            defaultValue={(params as RuleParams["busy_block_overlap"]).default_minutes}
            className={`${input} w-16`}
          />
          minutes
        </label>
      ) : null}

      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? true} />
        Enabled
      </label>
      <button className="self-start rounded bg-neutral-900 px-3 py-1.5 text-white">{rule ? "Save rule" : "Add rule"}</button>
    </form>
  );
}
