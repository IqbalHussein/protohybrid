"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Panel } from "@/components/ui/panel";
import { FormMessage, type ActionState } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { acceptPlan } from "./actions";

type Start = "this" | "next";

export function AcceptForm({
  start,
  nextLabel,
  hasActive,
}: {
  start: Start;
  nextLabel: string; // e.g. "23 Nov"
  hasActive: boolean;
}) {
  const router = useRouter();
  const [state, action] = useActionState<ActionState, FormData>(acceptPlan, {});
  const [choice, setChoice] = useState<Start>(start);

  const pick = (value: Start) => {
    setChoice(value);
    // The preview's dates depend on the start, so reload it.
    router.replace(`/plan?preview=1&start=${value}`, { scroll: false });
  };

  const option = "flex min-h-11 cursor-pointer items-center gap-3 text-sm";
  const box = "size-5 shrink-0 accent-chalk";

  return (
    <Panel>
      <form action={action} className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-1">
          <legend className="stretch-semi mb-1 text-base font-bold">When should it start?</legend>
          <label className={option}>
            <input type="radio" name="start" value="next" checked={choice === "next"} onChange={() => pick("next")} className={box} />
            Start next Monday ({nextLabel})
          </label>
          <label className={option}>
            <input type="radio" name="start" value="this" checked={choice === "this"} onChange={() => pick("this")} className={box} />
            Start this week (past days skipped)
          </label>
        </fieldset>

        <div className="flex flex-col gap-1">
          <label className={option}>
            <input type="checkbox" name="allow_same_day" defaultChecked className={box} />
            Don&apos;t warn when two hard sessions share a day
          </label>
          <p className="pl-8 text-xs text-chalk-faint">
            Updates your &lsquo;No back-to-back hard days&rsquo; rule. Consecutive hard days are still flagged.
          </p>
        </div>

        {hasActive && (
          <p className="text-sm text-chalk-muted">
            Replaces your current plan. Sessions you&apos;ve logged are kept; un-logged future sessions are removed.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <FormMessage state={state} />
          <SubmitButton pendingLabel="Saving…" className="h-12 w-full sm:w-auto sm:self-start sm:px-8">
            Accept plan
          </SubmitButton>
        </div>
      </form>
    </Panel>
  );
}
