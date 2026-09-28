import Link from "next/link";
import { notFound } from "next/navigation";
import ConfirmButton from "@/components/ConfirmButton";
import SessionForm from "@/components/calendar/SessionForm";
import { getRoutineOptions, getSession } from "@/lib/calendar/queries";
import { formatDistance, formatPace, formatRunDuration, secondsToMinutes } from "@/lib/calendar/runs";
import { SESSION_STATUS_LABELS } from "@/lib/types";
import { mondayOf } from "@/lib/week";
import {
  completeRun,
  deleteSession,
  setSessionStatus,
  startPlannedLift,
  updateSession,
} from "../../actions";

/**
 * One session: edit it, move it, and record what happened (spec flows #2–#4,
 * #6). Also the reschedule path that works without JavaScript, which is why
 * the same date and time fields the grid drags are plain inputs here.
 */
export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await getSession(id);
  if (!session) notFound();

  const routines = session.type === "lift" ? await getRoutineOptions() : [];
  const back = `/calendar?week=${mondayOf(session.plannedDate)}`;

  const isLift = session.type === "lift";
  const done = session.status === "completed";
  const started = Boolean(session.lift?.started_at);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold capitalize">
            {isLift ? session.lift?.focus ?? "Lift" : `${session.run?.run_type ?? ""} run`}
          </h1>
          <p className="text-sm text-neutral-500">
            {session.plannedDate} · {SESSION_STATUS_LABELS[session.status]}
          </p>
        </div>
        <Link href={back} className="text-sm text-neutral-500 underline">
          Week
        </Link>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">What happened</h2>

        {isLift ? (
          done ? (
            <Link
              href={`/workout/${id}/summary`}
              className="rounded bg-neutral-900 px-4 py-3 text-center text-white"
            >
              View the logged workout
            </Link>
          ) : (
            <>
              {/* Spec flow #6: the handoff to the logger. A lift has no manual
                  "mark complete" — it completes by being logged. */}
              <form action={startPlannedLift}>
                <input type="hidden" name="sessionId" value={id} />
                <button className="w-full rounded bg-neutral-900 px-4 py-3 text-white">
                  {started ? "Resume logging this workout" : "Start this workout"}
                </button>
              </form>
              <p className="text-xs text-neutral-500">
                Lifts complete by being logged. Finishing the workout marks this session complete.
              </p>
            </>
          )
        ) : done ? (
          <div className="rounded border border-neutral-200 px-4 py-3 text-sm">
            <p className="font-medium">
              Completed
              {session.run?.strava_activity_id ? (
                <span className="font-normal text-neutral-500">
                  {" "}
                  · from Strava{session.run.strava_name ? `: ${session.run.strava_name}` : ""}
                </span>
              ) : null}
            </p>
            <p className="mt-1 tabular-nums text-neutral-600">
              {[
                formatDistance(session.run?.actual_distance_km ?? null),
                formatRunDuration(session.run?.actual_duration_sec ?? null),
                formatPace(session.run?.actual_pace_sec_per_km ?? null),
                session.run?.actual_avg_hr ? `${Math.round(session.run.actual_avg_hr)} bpm` : null,
                session.run?.actual_elevation_m ? `${Math.round(session.run.actual_elevation_m)} m climb` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "No distance or duration recorded."}
            </p>
            <form action={setSessionStatus} className="mt-2">
              <input type="hidden" name="sessionId" value={id} />
              <input type="hidden" name="status" value="planned" />
              <button className="text-xs text-neutral-500 underline">Reopen as planned</button>
            </form>
          </div>
        ) : (
          <form action={completeRun} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="sessionId" value={id} />
            <label className="flex w-28 flex-col gap-1 text-sm">
              <span className="text-xs uppercase tracking-wide text-neutral-400">Distance</span>
              <input
                name="actualDistanceKm"
                inputMode="decimal"
                defaultValue={session.run?.target_distance_km ?? ""}
                className="rounded border border-neutral-300 px-3 py-2 text-base"
              />
            </label>
            <label className="flex w-28 flex-col gap-1 text-sm">
              <span className="text-xs uppercase tracking-wide text-neutral-400">Minutes</span>
              <input
                name="actualDurationMin"
                inputMode="numeric"
                defaultValue={secondsToMinutes(session.run?.target_duration_sec ?? null) ?? ""}
                className="rounded border border-neutral-300 px-3 py-2 text-base"
              />
            </label>
            <button className="rounded bg-neutral-900 px-4 py-2.5 text-white">Mark complete</button>
            {/* The same columns Strava sync fills; the UI must not imply
                hand-entered numbers arrived on their own. */}
            <span className="w-full text-xs text-neutral-400">
              Entered by hand — pace is worked out from the two. With Strava connected in Settings, a
              synced run on this day fills these in instead.
            </span>
          </form>
        )}

        {session.status === "completed" ? null : (
          <form action={setSessionStatus} className="self-start">
            <input type="hidden" name="sessionId" value={id} />
            <input type="hidden" name="status" value={session.status === "skipped" ? "planned" : "skipped"} />
            <button className="text-sm text-neutral-500 underline">
              {session.status === "skipped" ? "Put back on the plan" : "Mark skipped"}
            </button>
          </form>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-neutral-100 pt-6">
        <h2 className="text-lg font-medium">Plan</h2>
        <SessionForm
          action={updateSession}
          type={session.type}
          date={session.plannedDate}
          session={session}
          routines={routines}
          submitLabel="Save"
        />
      </section>

      <section className="flex flex-col gap-2 border-t border-neutral-100 pt-6">
        {done ? (
          /* Deleting a session cascades to lift_details, lift_sets and the PRs
             it set. A completed session is therefore never deletable from
             here; the workout summary deletes it, and names what goes with
             it first. */
          <p className="text-xs text-neutral-400">
            {isLift
              ? "This session has a logged workout. Delete it from its summary, which names the sets and PRs that would go with it."
              : "Reopen this run as planned before deleting it."}
          </p>
        ) : (
          <form action={deleteSession} className="self-start">
            <input type="hidden" name="sessionId" value={id} />
            <ConfirmButton
              message="Remove this session from the week?"
              className="text-xs text-neutral-400 underline hover:text-red-600"
            >
              Remove from the week
            </ConfirmButton>
          </form>
        )}
      </section>
    </main>
  );
}
