"use client";

import { useActionState } from "react";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage, type ActionState } from "@/components/ui/form-message";
import { addBusyBlock } from "./busy-blocks-actions";

export function BusyBlockForm({ today }: { today: string }) {
  const [state, action] = useActionState<ActionState, FormData>(addBusyBlock, {});
  return (
    <form action={action} className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Field label="Name" className="col-span-2 sm:col-span-4">
        <Input name="title" required maxLength={200} placeholder="Work shift" />
      </Field>
      <Field label="Date" className="col-span-2">
        <Input type="date" name="date" required defaultValue={today} />
      </Field>
      <Field label="Start">
        <Input type="time" name="start" required />
      </Field>
      <Field label="End" hint="Earlier than start means it ends the next day.">
        <Input type="time" name="end" required />
      </Field>
      <div className="col-span-2 flex flex-wrap items-center gap-4 sm:col-span-4">
        <SubmitButton variant="secondary" pendingLabel="Adding…">
          Add busy time
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
