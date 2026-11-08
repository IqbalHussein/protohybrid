"use client";

import { useActionState } from "react";
import type { WeightUnit } from "@/lib/types";
import { FormMessage, type ActionState } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/cn";
import { saveWeightUnit } from "./actions";

export function WeightUnitForm({ current }: { current: WeightUnit }) {
  const [state, action] = useActionState<ActionState, FormData>(saveWeightUnit, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset className="flex gap-2">
        <legend className="mb-2 text-sm text-chalk-muted">
          Lift weights are entered and shown in this unit. Existing lifts convert automatically.
        </legend>
        {(["lb", "kg"] as const).map((u) => (
          <label
            key={u}
            className={cn(
              "flex h-10 cursor-pointer items-center gap-2 rounded-control border px-4 text-sm font-semibold",
              "border-ink-line has-[:checked]:border-chalk has-[:checked]:bg-ink-sunken has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-chalk",
            )}
          >
            <input type="radio" name="weight_unit" value={u} defaultChecked={current === u} className="sr-only" />
            {u === "lb" ? "Pounds (lb)" : "Kilograms (kg)"}
          </label>
        ))}
      </fieldset>
      <div className="flex items-center gap-4">
        <SubmitButton variant="secondary" pendingLabel="Saving…">
          Save unit
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
