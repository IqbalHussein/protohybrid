"use client";

import Link from "next/link";
import { useActionState, useEffect, type DragEvent } from "react";
import { cn } from "@/lib/cn";
import { formatDistance, formatDuration, formatPace, runTypeLabel } from "@/lib/runs";
import { formatDateLabel } from "@/lib/time";
import { Dialog, useCloseDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage, type ActionState } from "@/components/ui/form-message";
import { sessionToneClasses } from "@/components/ui/session-tone";
import { CompleteRunForm } from "@/components/complete-run-form";
import { deleteSession, moveSessionForm, setStatus } from "./actions";
import type { CardRun, CardSession } from "./data";
import { focusLabel } from "@/lib/lifts";

// Small text-style action that inherits the card's text colour (works on
// hollow and solid cards alike).
const actionClass =
  "rounded px-1 py-0.5 text-xs font-semibold underline decoration-1 underline-offset-2 hover:decoration-2";

function title(s: CardSession): string {
  if (s.type === "run") return `${runTypeLabel(s.run?.runType ?? "run")} run`;
  const focus = s.lift?.focus?.trim() || "Lift";
  return `${focusLabel(focus)} lift`;
}

function statusLabel(s: CardSession): string {
  return s.status === "completed" ? "Done" : s.status === "skipped" ? "Skipped" : "Planned";
}

function RunFigures({ label, km, sec, pace }: { label: string; km: number | null; sec: number | null; pace: number | null }) {
  const parts = [
    km !== null && { k: "km", v: formatDistance(km), u: "km" },
    sec !== null && { k: "time", v: formatDuration(sec), u: "" },
    pace !== null && { k: "pace", v: formatPace(pace), u: "/km" },
  ].filter(Boolean) as { k: string; v: string; u: string }[];
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
      <span className="opacity-70">{label}</span>
      {parts.map((p) => (
        <span key={p.k} className="stretch-semi font-bold tabular-nums">
          {p.v}
          {p.u && <span className="ml-0.5 font-medium opacity-70">{p.u}</span>}
        </span>
      ))}
    </div>
  );
}

function RunBody({ run, status }: { run: CardRun; status: CardSession["status"] }) {
  const hasActual = run.actualDistanceKm !== null || run.actualDurationSec !== null;
  return (
    <div className="flex flex-col gap-1">
      <RunFigures label="Plan" km={run.targetDistanceKm} sec={run.targetDurationSec} pace={run.targetPaceSec} />
      {status === "completed" && hasActual && (
        <RunFigures label="Done" km={run.actualDistanceKm} sec={run.actualDurationSec} pace={run.actualPaceSec} />
      )}
    </div>
  );
}

function useCloseOnOk(state: ActionState) {
  const close = useCloseDialog();
  useEffect(() => {
    if (state.ok) close();
  }, [state, close]);
}

function MoveForm({ session }: { session: CardSession }) {
  const [state, action] = useActionState<ActionState, FormData>(moveSessionForm, {});
  useCloseOnOk(state);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="session_id" value={session.id} />
      <div className="grid grid-cols-2 gap-4">
        <Field label="Date">
          <Input type="date" name="date" required defaultValue={session.date} />
        </Field>
        <Field label="Start time (optional)" hint="Clear it to unset the time">
          <Input type="time" name="start_time" defaultValue={session.startTime ?? ""} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton pendingLabel="Moving…">Move session</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function DeleteForm({ session }: { session: CardSession }) {
  const [state, action] = useActionState<ActionState, FormData>(deleteSession, {});
  useCloseOnOk(state);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="session_id" value={session.id} />
      <p className="text-sm text-chalk-muted">
        This removes the {title(session).toLowerCase()} on {formatDateLabel(session.date)}
        {session.status === "completed" ? ", including everything you logged for it" : ""}. It can&apos;t be undone.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton variant="danger" className="border border-danger" pendingLabel="Deleting…">
          Delete session
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function CompleteRunBody({ session }: { session: CardSession }) {
  const close = useCloseDialog();
  const run = session.run;
  const editing = session.status === "completed";
  return (
    <CompleteRunForm
      sessionId={session.id}
      onDone={close}
      defaults={{
        distanceKm: editing ? run?.actualDistanceKm : run?.targetDistanceKm,
        durationSec: editing ? run?.actualDurationSec : run?.targetDurationSec,
        avgHr: run?.avgHr,
        elevationM: run?.elevationM,
        notes: run?.notes,
      }}
    />
  );
}

function StatusButton({ session }: { session: CardSession }) {
  const [state, action] = useActionState<ActionState, FormData>(setStatus, {});
  const next = session.status === "skipped" ? "planned" : "skipped";
  return (
    <form action={action} className="contents">
      <input type="hidden" name="session_id" value={session.id} />
      <input type="hidden" name="status" value={next} />
      <button type="submit" className={actionClass}>
        {next === "skipped" ? "Skip" : "Unskip"}
      </button>
      {state.error && (
        <span role="alert" className="basis-full text-xs">
          {state.error}
        </span>
      )}
    </form>
  );
}

export function SessionCard({
  session,
  onDragStart,
  onDragEnd,
}: {
  session: CardSession;
  onDragStart: (e: DragEvent, session: CardSession) => void;
  onDragEnd: () => void;
}) {
  const label = title(session);
  const when = `${label} on ${formatDateLabel(session.date)}`;

  return (
    <article
      draggable
      onDragStart={(e) => onDragStart(e, session)}
      onDragEnd={onDragEnd}
      aria-label={`${label}, ${statusLabel(session).toLowerCase()}`}
      className={cn(
        "flex cursor-grab flex-col gap-2 rounded-control p-3 active:cursor-grabbing",
        sessionToneClasses(session.type, session.status),
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="stretch-semi text-sm font-bold leading-tight">{label}</h3>
        <span className="shrink-0 text-xs font-semibold tabular-nums opacity-80">
          {session.startTime ?? ""}
          {session.durationMin ? `${session.startTime ? ", " : ""}${session.durationMin} min` : ""}
        </span>
      </div>
      <span className="sr-only">{statusLabel(session)}</span>

      {session.run && <RunBody run={session.run} status={session.status} />}
      {session.lift && (
        <div className="flex flex-col gap-0.5 text-xs">
          {session.lift.routineName && <span className="font-semibold">{session.lift.routineName}</span>}
          {session.status === "completed" && (
            <span className="opacity-80">
              {session.lift.setCount} {session.lift.setCount === 1 ? "set" : "sets"} logged
            </span>
          )}
          {session.lift.notes && <span className="line-clamp-2 opacity-70">{session.lift.notes}</span>}
        </div>
      )}

      {session.conflicts.length > 0 && (
        <ul className="flex flex-col gap-1">
          {session.conflicts.map((m) => (
            <li key={m} className="rounded bg-chalk px-2 py-1 text-xs font-medium text-ink no-underline">
              <span aria-hidden className="mr-1 font-extrabold">
                !
              </span>
              <span className="sr-only">Conflict: </span>
              {m}
            </li>
          ))}
        </ul>
      )}

      <div className="-mx-1 flex flex-wrap items-center gap-x-1 gap-y-1 no-underline">
        {session.type === "run" && session.status !== "skipped" && (
          <Dialog
            trigger={session.status === "completed" ? "Edit" : "Complete"}
            triggerClassName={actionClass}
            triggerAriaLabel={`${session.status === "completed" ? "Edit" : "Complete"} ${when}`}
            title={session.status === "completed" ? "Edit run" : "Complete run"}
          >
            <CompleteRunBody session={session} />
          </Dialog>
        )}
        {session.type === "lift" && session.status !== "skipped" && (
          <Link
            href={`/lifts/log?session=${session.id}`}
            className={actionClass}
            aria-label={`${session.status === "completed" ? "Edit sets for" : "Log"} ${when}`}
          >
            {session.status === "completed" ? "Edit sets" : "Log lift"}
          </Link>
        )}
        {session.status !== "completed" && <StatusButton session={session} />}
        <Dialog trigger="Move" triggerClassName={actionClass} triggerAriaLabel={`Move ${when}`} title="Move session">
          <MoveForm session={session} />
        </Dialog>
        <Dialog trigger="Delete" triggerClassName={actionClass} triggerAriaLabel={`Delete ${when}`} title="Delete session?">
          <DeleteForm session={session} />
        </Dialog>
      </div>
    </article>
  );
}
