"use client";

import { useActionState, useEffect, useState } from "react";
import { LIFT_FOCUSES, RUN_TYPES, type SessionType } from "@/lib/types";
import { runTypeLabel } from "@/lib/runs";
import { cn } from "@/lib/cn";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage, type ActionState } from "@/components/ui/form-message";
import { useCloseDialog } from "@/components/ui/dialog";
import { planSession } from "./actions";

function focusLabel(f: string) {
  return f === "full-body" ? "Full body" : f.charAt(0).toUpperCase() + f.slice(1);
}

export function PlanSessionForm({
  date,
  routines,
}: {
  date: string;
  routines: { id: string; name: string }[];
}) {
  const [kind, setKind] = useState<SessionType>("run");
  const [state, action] = useActionState<ActionState, FormData>(planSession, {});
  const close = useCloseDialog();

  useEffect(() => {
    if (state.ok) close();
  }, [state, close]);

  return (
    <form action={action} className="flex flex-col gap-5">
      <fieldset className="flex gap-2">
        <legend className="mb-2 text-sm font-medium text-chalk-muted">Session</legend>
        {(["run", "lift"] as const).map((k) => (
          <label
            key={k}
            className={cn(
              "flex h-10 flex-1 cursor-pointer items-center justify-center rounded-control border-2 text-sm font-semibold",
              "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-chalk",
              kind === k
                ? k === "run"
                  ? "border-run bg-run text-ink"
                  : "border-lift bg-lift text-ink"
                : k === "run"
                  ? "border-run/50 text-chalk"
                  : "border-lift/50 text-chalk",
            )}
          >
            <input
              type="radio"
              name="kind"
              value={k}
              checked={kind === k}
              onChange={() => setKind(k)}
              className="sr-only"
            />
            {k === "run" ? "Run" : "Lift"}
          </label>
        ))}
      </fieldset>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Date">
          <Input type="date" name="date" required defaultValue={date} />
        </Field>
        <Field label="Start time (optional)">
          <Input type="time" name="start_time" />
        </Field>

        {kind === "run" ? (
          <>
            <Field label="Run type">
              <Select name="run_type" defaultValue="easy" required>
                {RUN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {runTypeLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Planned minutes (optional)" hint="Defaults to the target time">
              <Input type="number" name="duration_min" min="1" max="1440" step="1" inputMode="numeric" />
            </Field>
            <Field label="Target distance, km (optional)">
              <Input type="number" name="target_distance_km" min="0.01" step="0.01" inputMode="decimal" />
            </Field>
            <Field label="Target time (optional)" hint="mm:ss or h:mm:ss">
              <Input type="text" name="target_duration" placeholder="50:00" pattern="\d+:\d{1,2}(:\d{1,2})?" />
            </Field>
            <Field label="Target pace per km (optional)" hint="Worked out from distance and time if blank">
              <Input type="text" name="target_pace" placeholder="5:00" pattern="\d+:\d{1,2}" />
            </Field>
          </>
        ) : (
          <>
            <Field label="Focus">
              <Select name="focus" defaultValue="legs" required>
                {LIFT_FOCUSES.map((f) => (
                  <option key={f} value={f}>
                    {focusLabel(f)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Planned minutes (optional)">
              <Input type="number" name="duration_min" min="1" max="1440" step="1" inputMode="numeric" />
            </Field>
            <Field
              label="Routine (optional)"
              className="col-span-2"
              hint={routines.length === 0 ? "Create routines on the Lifts page to plan from them." : undefined}
            >
              <Select name="routine_id" defaultValue="" disabled={routines.length === 0}>
                <option value="">No routine</option>
                {routines.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Plan notes (optional)" className="col-span-2">
              <Textarea name="notes" rows={2} placeholder="e.g. 5x5 squat, work up to RPE 8" />
            </Field>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton variant={kind === "run" ? "run" : "lift"} pendingLabel="Planning…">
          {kind === "run" ? "Plan run" : "Plan lift"}
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
