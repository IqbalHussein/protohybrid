"use client";

import { useActionState, useEffect } from "react";
import { completeRun } from "@/app/(app)/runs/actions";
import { formatDuration } from "@/lib/runs";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage, type ActionState } from "@/components/ui/form-message";

// Enter actuals for a planned run. Pre-fills from targets (or existing
// actuals when editing). onDone fires after a successful save, e.g. to close
// a dialog.
export function CompleteRunForm({
  sessionId,
  defaults,
  onDone,
}: {
  sessionId: string;
  defaults?: {
    distanceKm?: number | null;
    durationSec?: number | null;
    avgHr?: number | null;
    elevationM?: number | null;
    notes?: string | null;
  };
  onDone?: () => void;
}) {
  const [state, action] = useActionState<ActionState, FormData>(completeRun, {});
  useEffect(() => {
    if (state.ok) onDone?.();
  }, [state, onDone]);

  return (
    <form action={action} className="grid grid-cols-2 gap-4">
      <input type="hidden" name="session_id" value={sessionId} />
      <Field label="Distance (km)">
        <Input
          type="number"
          name="distance_km"
          required
          min="0.01"
          step="0.01"
          inputMode="decimal"
          defaultValue={defaults?.distanceKm ?? undefined}
        />
      </Field>
      <Field label="Duration" hint="mm:ss or h:mm:ss">
        <Input
          type="text"
          name="duration"
          required
          placeholder="45:30"
          pattern="\d+:\d{1,2}(:\d{1,2})?"
          defaultValue={defaults?.durationSec ? formatDuration(defaults.durationSec) : undefined}
        />
      </Field>
      <Field label="Average HR (optional)">
        <Input type="number" name="avg_hr" min="20" max="250" step="1" defaultValue={defaults?.avgHr ?? undefined} />
      </Field>
      <Field label="Elevation gain, m (optional)">
        <Input type="number" name="elevation_m" min="0" step="1" defaultValue={defaults?.elevationM ?? undefined} />
      </Field>
      <Field label="Notes (optional)" className="col-span-2">
        <Textarea name="notes" rows={2} defaultValue={defaults?.notes ?? undefined} />
      </Field>
      <div className="col-span-2 flex flex-wrap items-center gap-4">
        <SubmitButton variant="run" pendingLabel="Saving…">
          Save run
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
