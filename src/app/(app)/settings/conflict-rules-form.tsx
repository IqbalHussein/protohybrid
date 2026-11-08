"use client";

import { useActionState, useState } from "react";
import { LIFT_FOCUSES, RUN_TYPES, type ConflictRule, type SessionType } from "@/lib/types";
import { runTypeLabel } from "@/lib/runs";
import { cn } from "@/lib/cn";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage, type ActionState } from "@/components/ui/form-message";
import { Panel } from "@/components/ui/panel";
import { addRule, deleteRule, saveRule, toggleRule } from "./conflict-rules-actions";
import { focusLabel } from "@/lib/lifts";

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function CheckboxGroup({
  legend,
  name,
  options,
  selected,
  label,
  hint,
}: {
  legend: string;
  name: string;
  options: string[];
  selected: string[];
  label: (v: string) => string;
  hint?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-chalk-muted">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o}
            className={cn(
              "flex h-8 cursor-pointer items-center gap-2 rounded-control border border-ink-line px-3 text-sm",
              "has-[:checked]:border-chalk has-[:checked]:text-chalk has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-chalk",
              "text-chalk-muted",
            )}
          >
            <input type="checkbox" name={name} value={o} defaultChecked={selected.includes(o)} className="accent-chalk" />
            {label(o)}
          </label>
        ))}
      </div>
      {hint && <span className="text-xs text-chalk-faint">{hint}</span>}
    </fieldset>
  );
}

function SideFields({
  prefix,
  title,
  type,
  runTypes,
  liftFocus,
}: {
  prefix: "a" | "b";
  title: string;
  type: SessionType | null;
  runTypes: string[];
  liftFocus: string[];
}) {
  const [kind, setKind] = useState<string>(type ?? "");
  const focusOptions = [...new Set([...LIFT_FOCUSES, ...liftFocus])];
  return (
    <div className="flex flex-col gap-3 rounded-control border border-ink-line p-3">
      <Field label={title}>
        <Select name={`session_type_${prefix}`} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Any session</option>
          <option value="run">A run</option>
          <option value="lift">A lift</option>
        </Select>
      </Field>
      {kind !== "lift" && (
        <CheckboxGroup
          legend="Run types"
          name={`${prefix}_run_types`}
          options={[...RUN_TYPES]}
          selected={runTypes}
          label={runTypeLabel}
          hint="None checked means any run."
        />
      )}
      {kind !== "run" && (
        <CheckboxGroup
          legend="Lift focuses"
          name={`${prefix}_lift_focus`}
          options={focusOptions}
          selected={liftFocus}
          label={focusLabel}
          hint="None checked means any lift."
        />
      )}
    </div>
  );
}

function ParamFields({ rule }: { rule: ConflictRule }) {
  const p = rule.params as Record<string, unknown>;
  switch (rule.rule_type) {
    case "min_hours_between":
      return (
        <div className="flex flex-col gap-4">
          <Field label="Minimum hours between them" className="max-w-xs">
            <Input type="number" name="hours" min="1" max="168" step="0.5" required defaultValue={Number(p.hours) || 24} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <SideFields prefix="a" title="First session" type={rule.session_type_a} runTypes={arr(p.a_run_types)} liftFocus={arr(p.a_lift_focus)} />
            <SideFields prefix="b" title="Second session" type={rule.session_type_b} runTypes={arr(p.b_run_types)} liftFocus={arr(p.b_lift_focus)} />
          </div>
        </div>
      );
    case "no_back_to_back_hard":
      return (
        <div className="flex flex-col gap-4">
          <CheckboxGroup legend="Hard run types" name="hard_run_types" options={[...RUN_TYPES]} selected={arr(p.hard_run_types)} label={runTypeLabel} />
          <CheckboxGroup
            legend="Hard lift focuses"
            name="hard_lift_focus"
            options={[...new Set([...LIFT_FOCUSES, ...arr(p.hard_lift_focus)])]}
            selected={arr(p.hard_lift_focus)}
            label={focusLabel}
          />
        </div>
      );
    case "max_days_without_rest":
      return (
        <Field label="Most training days in a row" className="max-w-xs">
          <Input type="number" name="max_days" min="1" max="30" step="1" required defaultValue={Number(p.max_days) || 6} />
        </Field>
      );
    case "busy_block_overlap":
      return <p className="text-sm text-chalk-muted">This rule has no settings. Sessions without a start time are never flagged.</p>;
  }
}

export function RuleEditor({ rule, description }: { rule: ConflictRule; description: string }) {
  const [saveState, save] = useActionState<ActionState, FormData>(saveRule, {});
  const [toggleState, toggle] = useActionState<ActionState, FormData>(toggleRule, {});
  const [deleteState, remove] = useActionState<ActionState, FormData>(deleteRule, {});
  const name = rule.name?.trim() || "Untitled rule";

  return (
    <Panel className={cn("flex flex-col gap-4", !rule.enabled && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-prose flex-col gap-1">
          <h3 className="stretch-semi font-bold">
            {name}
            {!rule.enabled && <span className="ml-2 text-sm font-medium text-chalk-faint">Off</span>}
          </h3>
          <p className="text-sm text-chalk-muted">{description}</p>
        </div>
        <form action={toggle} className="flex items-center gap-3">
          <input type="hidden" name="id" value={rule.id} />
          <input type="hidden" name="enabled" value={String(!rule.enabled)} />
          <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…" aria-label={`${rule.enabled ? "Turn off" : "Turn on"} ${name}`}>
            {rule.enabled ? "Turn off" : "Turn on"}
          </SubmitButton>
        </form>
      </div>
      <FormMessage state={toggleState} />

      <details className="group flex flex-col gap-4">
        <summary className="w-fit cursor-pointer rounded text-sm font-semibold text-chalk-muted hover:text-chalk">
          Edit rule
        </summary>
        <form action={save} className="mt-4 flex flex-col gap-5">
          <input type="hidden" name="id" value={rule.id} />
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Name" className="min-w-56 flex-1">
              <Input name="name" maxLength={80} defaultValue={rule.name ?? ""} placeholder="Untitled rule" />
            </Field>
            <label className="flex h-10 items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={rule.enabled} className="accent-chalk" />
              On
            </label>
          </div>
          <ParamFields rule={rule} />
          <div className="flex flex-wrap items-center gap-4">
            <SubmitButton pendingLabel="Saving…">Save rule</SubmitButton>
            <FormMessage state={saveState} />
          </div>
        </form>
        <form action={remove} className="mt-4 flex flex-wrap items-center gap-4 border-t border-ink-line pt-4">
          <input type="hidden" name="id" value={rule.id} />
          <SubmitButton variant="danger" size="sm" pendingLabel="Deleting…">
            Delete rule
          </SubmitButton>
          <FormMessage state={deleteState} />
        </form>
      </details>
    </Panel>
  );
}

export function AddRuleForm() {
  const [state, action] = useActionState<ActionState, FormData>(addRule, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <Field label="Add a rule" className="min-w-64">
        <Select name="rule_type" defaultValue="min_hours_between">
          <option value="min_hours_between">Minimum gap between two kinds of session</option>
          <option value="no_back_to_back_hard">No back-to-back hard days</option>
          <option value="max_days_without_rest">Regular rest days</option>
          <option value="busy_block_overlap">Don&apos;t overlap busy blocks</option>
        </Select>
      </Field>
      <SubmitButton variant="secondary" pendingLabel="Adding…">
        Add rule
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
