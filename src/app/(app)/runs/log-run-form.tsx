"use client";

import { useActionState, useEffect, useRef } from "react";
import { logRun } from "./actions";
import { RUN_TYPES, runTypeLabel } from "@/lib/runs";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { FormMessage, type ActionState } from "@/components/ui/form-message";

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function LogRunForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(logRun, {});
  const dateRef = useRef<HTMLInputElement>(null);

  // Default to the browser's local date, and restore it after React resets
  // the form on a successful submit.
  useEffect(() => {
    if (dateRef.current && !dateRef.current.value) dateRef.current.value = localToday();
  }, [state]);

  return (
    <form action={formAction} className="grid grid-cols-2 gap-4">
      <Field label="Date">
        <Input ref={dateRef} type="date" name="date" required />
      </Field>
      <Field label="Type">
        <Select name="run_type" required defaultValue="easy">
          {RUN_TYPES.map((t) => (
            <option key={t} value={t}>
              {runTypeLabel(t)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Distance (km)">
        <Input type="number" name="distance_km" required min="0.01" step="0.01" inputMode="decimal" />
      </Field>
      <Field label="Duration" hint="mm:ss or h:mm:ss">
        <Input type="text" name="duration" required placeholder="45:30" pattern="\d+:\d{1,2}(:\d{1,2})?" />
      </Field>
      <Field label="Average HR (optional)">
        <Input type="number" name="avg_hr" min="20" max="250" step="1" inputMode="numeric" />
      </Field>
      <Field label="Elevation gain, m (optional)">
        <Input type="number" name="elevation_m" min="0" step="1" inputMode="numeric" />
      </Field>
      <Field label="Notes (optional)" className="col-span-2">
        <Textarea name="notes" rows={2} />
      </Field>
      <div className="col-span-2 flex flex-wrap items-center gap-4">
        <Button type="submit" variant="run" disabled={pending}>
          {pending ? "Saving…" : "Log run"}
        </Button>
        {!pending && <FormMessage state={state} />}
      </div>
    </form>
  );
}
