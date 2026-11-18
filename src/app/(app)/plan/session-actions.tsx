"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { moveSessionForm } from "../week/actions";
import { CompleteRunForm } from "@/components/complete-run-form";
import { buttonClass } from "@/components/ui/button";
import { Dialog, useCloseDialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { FormMessage, type ActionState } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { swapSessions } from "./actions";
import type { PlanSessionView } from "./data";
import { sessionOptionLabel, sessionTitle } from "./labels";

// Dialog bodies refresh the page on success: the plan page isn't revalidated
// by the week actions it reuses.
function useRefreshOnOk(state: ActionState, close: () => void) {
  const router = useRouter();
  useEffect(() => {
    if (state.ok) {
      close();
      router.refresh();
    }
  }, [state, close, router]);
}

function MoveForm({ session }: { session: PlanSessionView }) {
  const close = useCloseDialog();
  const [state, action] = useActionState<ActionState, FormData>(moveSessionForm, {});
  useRefreshOnOk(state, close);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="session_id" value={session.id ?? ""} />
      <input type="hidden" name="start_time" value="" />
      <Field label="New date">
        <Input type="date" name="date" required defaultValue={session.date} className="h-11" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Moving…" className="h-11">
          Move session
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function SwapForm({ session, candidates }: { session: PlanSessionView; candidates: PlanSessionView[] }) {
  const close = useCloseDialog();
  const [state, action] = useActionState<ActionState, FormData>(swapSessions, {});
  useRefreshOnOk(state, close);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="session_a" value={session.id ?? ""} />
      <Field label="Swap with" hint="They trade dates and start times.">
        <Select name="session_b" required defaultValue="" className="h-11">
          <option value="" disabled>
            Choose a session
          </option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id ?? ""}>
              {sessionOptionLabel(c)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Swapping…" className="h-11">
          Swap sessions
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function RunLogBody({ session }: { session: PlanSessionView }) {
  const close = useCloseDialog();
  const router = useRouter();
  return (
    <CompleteRunForm
      sessionId={session.id ?? ""}
      defaults={{ durationSec: session.durationMin > 0 ? session.durationMin * 60 : null }}
      onDone={() => {
        close();
        router.refresh();
      }}
    />
  );
}

// Log / Move / Swap for one planned session. Only rendered for real, planned
// sessions in the active plan.
export function SessionActions({ session, allSessions }: { session: PlanSessionView; allSessions: PlanSessionView[] }) {
  if (!session.id || session.status !== "planned") return null;

  const spanMs = 7 * 86_400_000;
  const at = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const candidates = allSessions.filter(
    (s) =>
      s.id && s.id !== session.id && s.status === "planned" && Math.abs(at(s.date) - at(session.date)) <= spanMs,
  );
  const title = sessionTitle(session);

  return (
    <div className="flex flex-wrap gap-2">
      {session.type === "lift" ? (
        <Link href={`/lifts/log?session=${session.id}`} className={buttonClass("lift", "md", "h-11")}>
          Log lift
        </Link>
      ) : (
        <Dialog trigger="Log run" title={`Log ${title.toLowerCase()}`} triggerClassName={buttonClass("run", "md", "h-11")}>
          <RunLogBody session={session} />
        </Dialog>
      )}
      <Dialog trigger="Move" title={`Move ${title.toLowerCase()}`} triggerClassName={buttonClass("secondary", "md", "h-11")}>
        <MoveForm session={session} />
      </Dialog>
      {candidates.length > 0 && (
        <Dialog trigger="Swap" title={`Swap ${title.toLowerCase()}`} triggerClassName={buttonClass("secondary", "md", "h-11")}>
          <SwapForm session={session} candidates={candidates} />
        </Dialog>
      )}
    </div>
  );
}
