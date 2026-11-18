import { formatDateLabel } from "@/lib/time";
import type { LiftPrescription, RunPrescription } from "@/lib/planner";
import { Badge } from "@/components/ui/badge";
import type { PlanSessionView } from "./data";
import { INTENSITY_LABEL, STATUS_LABEL, bySlot, sessionTitle, slotLabel } from "./labels";
import { SessionActions } from "./session-actions";

function LiftBody({ rx }: { rx: LiftPrescription }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-chalk-muted">{rx.description}</p>
      {rx.exercises.length > 0 && (
        <ul className="divide-y divide-ink-line rounded-control border border-ink-line">
          {rx.exercises.map((e, i) => (
            <li key={`${e.name}-${i}`} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{e.name}</span>
                <span className="block text-xs text-chalk-faint">{e.slot}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {e.sets} × {e.repsLow === e.repsHigh ? e.repsLow : `${e.repsLow}–${e.repsHigh}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-chalk-faint">
        RPE {rx.rpe} · rest {Math.round(rx.restSec / 30) / 2} min between sets
      </p>
    </div>
  );
}

function RunBody({ rx }: { rx: RunPrescription }) {
  return <p className="text-sm text-chalk-muted">{rx.description}</p>;
}

function SessionDetail({ s, active, all }: { s: PlanSessionView; active: boolean; all: PlanSessionView[] }) {
  const slot = slotLabel(s.slot);
  return (
    <article
      aria-label={`${sessionTitle(s)} on ${formatDateLabel(s.date)}`}
      className="flex flex-col gap-3 border-t border-ink-line pt-4 first:border-t-0 first:pt-0"
    >
      <header className="flex flex-col gap-2">
        <h3 className="stretch-semi text-base font-bold">
          {slot && <span className="mr-2 text-chalk-muted">{slot}</span>}
          {sessionTitle(s)}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={s.type === "run" ? "run" : "lift"}>{s.type === "run" ? "Run" : "Lift"}</Badge>
          <Badge>{INTENSITY_LABEL[s.intensity]}</Badge>
          <Badge>{s.durationMin} min</Badge>
          {active && <Badge>{STATUS_LABEL[s.status]}</Badge>}
        </div>
      </header>
      {s.prescription?.kind === "lift" ? (
        <LiftBody rx={s.prescription} />
      ) : s.prescription?.kind === "run" ? (
        <RunBody rx={s.prescription} />
      ) : null}
      {s.rationale && (
        <details className="group text-sm text-chalk-muted">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-medium text-chalk [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="text-chalk-faint transition-transform group-open:rotate-90">›</span>
            Why this day?
          </summary>
          <p className="pb-2">{s.rationale}</p>
        </details>
      )}
      {active && <SessionActions session={s} allSessions={all} />}
    </article>
  );
}

// Inline detail for one day: every session on it, in AM/PM order.
export function DayDetail({
  id,
  sessions,
  active,
  allSessions,
}: {
  id: string;
  sessions: PlanSessionView[];
  active: boolean;
  allSessions: PlanSessionView[];
}) {
  return (
    <div id={id} className="flex flex-col gap-4 rounded-panel border border-ink-line-strong bg-ink-raised p-4 md:col-span-7 md:order-last">
      {[...sessions].sort(bySlot).map((s) => (
        <SessionDetail key={s.id ?? s.key} s={s} active={active} all={allSessions} />
      ))}
    </div>
  );
}
