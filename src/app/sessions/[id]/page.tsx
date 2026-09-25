import Link from "next/link";
import { notFound } from "next/navigation";
import { getLiftActuals, getSession, getSessionConflicts, sessionLabel } from "@/lib/calendar";
import { getRoutine, getRoutines, getSetsForSessions, type WorkoutExercise } from "@/lib/lift/queries";
import { formatDate, mondayOf } from "@/lib/dates";
import { formatKm, formatPace, formatSeconds, toClock } from "@/lib/format";
import { liftActualSummary } from "@/lib/summaries";
import { countsAsWork } from "@/lib/lift/math";
import { ConfirmButton } from "@/components/ConfirmButton";
import { SessionFields } from "@/components/SessionFields";
import { startPlannedWorkout } from "../../workout/actions";
import { deleteSession, logRunActual, setSessionStatus, updateSession } from "../actions";

const input = "rounded border border-neutral-300 px-3 py-2 text-base";

function StatusButton({ id, status, children }: { id: string; status: string; children: React.ReactNode }) {
  return (
    <form action={setSessionStatus}>
      <input type="hidden" name="sessionId" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className="rounded border border-neutral-300 px-3 py-1.5 text-sm">{children}</button>
    </form>
  );
}

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();

  const isLift = session.type === "lift";
  const [conflicts, routines, routine, liftSets, liftActuals] = await Promise.all([
    getSessionConflicts(session),
    isLift ? getRoutines() : Promise.resolve([]),
    isLift && session.routine_id ? getRoutine(session.routine_id) : Promise.resolve(null),
    isLift ? getSetsForSessions([id]) : Promise.resolve(new Map<string, WorkoutExercise[]>()),
    isLift ? getLiftActuals([id]) : Promise.resolve(new Map<string, { exercises: number; workingSets: number; volume: number }>()),
  ]);

  const run = session.run_details;
  const lift = session.lift_details;
  const logged = liftSets.get(id) ?? [];
  const started = lift?.started_at != null;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold">{sessionLabel(session)}</h1>
          <Link href={`/calendar?week=${mondayOf(session.planned_date)}`} className="text-sm text-neutral-500 underline">
            Calendar
          </Link>
        </div>
        <p className="text-sm text-neutral-500">
          {formatDate(session.planned_date, { year: "numeric" })}
          {session.planned_time ? ` · ${session.planned_time.slice(0, 5)}` : ""} ·{" "}
          <span className="capitalize">{session.status}</span>
          {session.ad_hoc ? " · ad hoc (not conflict-checked)" : ""}
        </p>
        {session.notes ? <p className="whitespace-pre-line text-sm text-neutral-700">{session.notes}</p> : null}
      </header>

      {conflicts.length ? (
        <section className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <ul className="list-disc pl-5">
            {conflicts.map((c) => (
              <li key={c.key}>
                <span className="font-medium">{c.ruleName}:</span> {c.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Planned vs. actual</h2>
        {run ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="py-1" />
                <th className="py-1">Planned</th>
                <th className="py-1">Actual</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Type", run.run_type, run.strava_name ?? (session.status === "completed" ? run.run_type : "—")],
                ["Distance", formatKm(run.target_distance_km), formatKm(run.actual_distance_km)],
                ["Pace", formatPace(run.target_pace_sec_per_km), formatPace(run.actual_pace_sec_per_km)],
                ["Duration", formatSeconds(run.target_duration_sec), formatSeconds(run.actual_duration_sec)],
                ["Avg HR", "—", run.actual_avg_hr != null ? `${Math.round(run.actual_avg_hr)} bpm` : "—"],
                ["Elevation", "—", run.actual_elevation_m != null ? `${Math.round(run.actual_elevation_m)} m` : "—"],
              ].map(([k, p, a]) => (
                <tr key={k} className="border-t border-neutral-100">
                  <td className="py-1.5 text-neutral-500">{k}</td>
                  <td className="py-1.5 capitalize">{p}</td>
                  <td className="py-1.5">{a}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              <span className="text-neutral-500">Planned:</span> <span className="capitalize">{lift?.focus}</span>
              {routine ? (
                <>
                  {" "}from{" "}
                  <Link href={`/routines/${routine.id}`} className="underline">
                    {routine.name}
                  </Link>
                </>
              ) : null}
            </p>
            <p>
              <span className="text-neutral-500">Actual:</span> {liftActualSummary(liftActuals.get(id)) ?? "—"}
            </p>
            {routine?.exercises.length || logged.length ? (
              <table className="w-full">
                <thead className="text-left text-xs uppercase tracking-wide text-neutral-400">
                  <tr>
                    <th className="py-1">Exercise</th>
                    <th className="py-1">Target</th>
                    <th className="py-1">Done</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...(routine?.exercises ?? []).map((re) => ({ ex: re.exercise, target: `${re.target_sets ?? "?"} × ${re.target_reps ?? "?"}` })),
                    ...logged
                      .filter((l) => !routine?.exercises.some((re) => re.exercise.id === l.exercise.id))
                      .map((l) => ({ ex: l.exercise, target: "—" })),
                  ].map(({ ex, target }) => {
                    const sets = logged.find((l) => l.exercise.id === ex.id)?.sets ?? [];
                    const work = sets.filter((s) => countsAsWork(s.set_type));
                    return (
                      <tr key={ex.id} className="border-t border-neutral-100">
                        <td className="py-1.5">{ex.name}</td>
                        <td className="py-1.5 text-neutral-500">{target}</td>
                        <td className="py-1.5">
                          {work.length
                            ? work.map((s) => `${s.weight ?? "—"}×${s.reps ?? "—"}`).join(", ")
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        {isLift ? (
          session.status === "completed" ? (
            <Link href={`/workout/${id}/summary`} className="rounded bg-neutral-900 px-4 py-3 text-center text-white">
              View workout summary
            </Link>
          ) : started ? (
            <Link href={`/workout/${id}`} className="rounded bg-neutral-900 px-4 py-3 text-center text-white">
              Resume workout
            </Link>
          ) : session.status === "planned" ? (
            <form action={startPlannedWorkout}>
              <input type="hidden" name="sessionId" value={id} />
              <button className="w-full rounded bg-neutral-900 px-4 py-3 text-white">Start workout</button>
            </form>
          ) : null
        ) : (
          <details className="rounded border border-neutral-200 p-3" open={session.status === "planned" && !run?.strava_activity_id}>
            <summary className="cursor-pointer text-sm font-medium">
              {run?.actual_distance_km != null ? "Edit actual run" : "Log actual run"}
            </summary>
            <form action={logRunActual} className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <input type="hidden" name="sessionId" value={id} />
              <label className="flex flex-col gap-1">
                Distance (km)
                <input name="actualDistance" inputMode="decimal" required defaultValue={run?.actual_distance_km ?? ""} className={input} />
              </label>
              <label className="flex flex-col gap-1">
                Duration (h:mm:ss)
                <input name="actualDuration" required placeholder="45:00" defaultValue={toClock(run?.actual_duration_sec)} className={input} />
              </label>
              <label className="flex flex-col gap-1">
                Avg HR (optional)
                <input name="actualHr" inputMode="numeric" defaultValue={run?.actual_avg_hr ?? ""} className={input} />
              </label>
              <label className="flex flex-col gap-1">
                Elevation m (optional)
                <input name="actualElevation" inputMode="numeric" defaultValue={run?.actual_elevation_m ?? ""} className={input} />
              </label>
              <button className="col-span-2 rounded bg-neutral-900 px-4 py-2.5 text-white">Save and mark completed</button>
            </form>
            {run?.strava_activity_id ? (
              <p className="mt-2 text-xs text-neutral-500">
                Synced from{" "}
                <a href={`https://www.strava.com/activities/${run.strava_activity_id}`} className="underline" target="_blank" rel="noreferrer">
                  Strava
                </a>
                . The next sync will overwrite manual edits.
              </p>
            ) : null}
          </details>
        )}

        <div className="flex flex-wrap gap-2">
          {session.status !== "skipped" && session.status !== "completed" ? (
            <StatusButton id={id} status="skipped">
              Mark skipped
            </StatusButton>
          ) : null}
          {session.status === "skipped" || (session.status === "completed" && !isLift) ? (
            <StatusButton id={id} status="planned">
              Back to planned
            </StatusButton>
          ) : null}
        </div>
      </section>

      <details className="rounded border border-neutral-200 p-3">
        <summary className="cursor-pointer text-sm font-medium">Edit plan</summary>
        <form action={updateSession} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="sessionId" value={id} />
          <SessionFields type={session.type} session={session} date={session.planned_date} routines={routines} />
          <button className="rounded bg-neutral-900 px-4 py-2.5 text-white">Save</button>
        </form>
      </details>

      <form action={deleteSession} className="border-t border-neutral-200 pt-4">
        <input type="hidden" name="sessionId" value={id} />
        <ConfirmButton
          message={isLift && logged.length ? "Delete this session and every set logged in it?" : "Delete this session?"}
          className="text-sm text-red-600 underline"
        >
          Delete session
        </ConfirmButton>
      </form>
    </main>
  );
}
