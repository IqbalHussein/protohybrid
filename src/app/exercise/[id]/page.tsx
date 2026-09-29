import Link from "next/link";
import { notFound } from "next/navigation";
import ConfirmButton from "@/components/ConfirmButton";
import LineChart from "@/components/LineChart";
import {
  getExercise,
  getExerciseHistory,
  getExercisePrs,
  getFilterOptions,
  getRestPreferences,
} from "@/lib/lift/queries";
import { roundTo } from "@/lib/lift/math";
import { currentBests, sessionStats, type StoredPr } from "@/lib/lift/stats";
import { DEFAULT_REST_SECONDS, PR_LABELS, UNSPECIFIED_EQUIPMENT, type PrRecordType } from "@/lib/lift/types";
import { saveRestPreference } from "@/app/workout/actions";
import { deleteCustomExercise, updateCustomExercise } from "@/app/exercise/actions";

/** Units for each record type, so "220" doesn't read as pounds when it's reps. */
const PR_UNITS: Record<PrRecordType, string> = {
  heaviest_weight: "lb",
  best_e1rm: "lb",
  most_reps: "reps",
  best_volume: "lb",
};

export default async function ExerciseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const exercise = await getExercise(id);
  if (!exercise) notFound();

  const [history, prs, restPrefs, options] = await Promise.all([
    getExerciseHistory(id),
    getExercisePrs(id),
    getRestPreferences([id]),
    exercise.is_custom ? getFilterOptions() : null,
  ]);

  const stats = sessionStats(history);
  const bests = currentBests(prs as StoredPr[]);
  const restSeconds = restPrefs.get(id) ?? DEFAULT_REST_SECONDS;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{exercise.name}</h1>
          <p className="text-sm text-neutral-500">
            {exercise.muscle_group ?? "—"} · {exercise.equipment ?? UNSPECIFIED_EQUIPMENT}
            {exercise.is_custom ? " · custom" : ""}
          </p>
        </div>
        <Link href="/" className="shrink-0 text-sm text-neutral-500 underline">
          Home
        </Link>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Personal records</h2>
        {Object.keys(bests).length === 0 ? (
          <p className="text-sm text-neutral-500">
            No records yet — they are detected when you finish a workout with this exercise in it.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-2">
            {(Object.keys(PR_LABELS) as PrRecordType[]).map((type) => {
              const pr = bests[type];
              if (!pr) return null;
              return (
                <div key={type} className="rounded border border-neutral-200 px-3 py-2.5">
                  <dt className="text-xs uppercase tracking-wide text-neutral-400">{PR_LABELS[type]}</dt>
                  <dd className="mt-0.5 tabular-nums">
                    <span className="text-lg font-medium">{roundTo(Number(pr.value)).toLocaleString()}</span>{" "}
                    <span className="text-sm text-neutral-500">{PR_UNITS[type]}</span>
                    {type === "most_reps" && pr.weight != null ? (
                      <span className="text-sm text-neutral-500"> @ {pr.weight}</span>
                    ) : null}
                    <span className="block text-xs text-neutral-400">{pr.achieved_at.slice(0, 10)}</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-lg font-medium">Progress</h2>
        {/* Three separate single-series charts rather than one chart with
            several y-scales: pounds and estimated maxima and session volume
            are different magnitudes and don't belong on a shared axis. */}
        <LineChart
          title="Heaviest set"
          unit="lb"
          data={stats.map((s) => ({ date: s.date, value: s.heaviestWeight }))}
          emptyMessage="Finish a workout with this exercise to start the chart."
        />
        <LineChart
          title="Best estimated 1RM"
          unit="lb"
          data={stats.map((s) => ({ date: s.date, value: roundTo(s.bestE1rm) }))}
          emptyMessage="Finish a workout with this exercise to start the chart."
        />
        <LineChart
          title="Volume per session"
          unit="lb"
          data={stats.map((s) => ({ date: s.date, value: s.volume }))}
          emptyMessage="Finish a workout with this exercise to start the chart."
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Rest timer</h2>
        <form action={saveRestPreference} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="exerciseId" value={id} />
          <label className="flex w-28 flex-col gap-0.5 text-xs text-neutral-500">
            Seconds
            <input
              name="restSeconds"
              inputMode="numeric"
              defaultValue={restSeconds}
              className="rounded border border-neutral-300 px-2 py-1.5 text-base text-neutral-900"
            />
          </label>
          <button className="rounded border border-neutral-900 px-4 py-2 text-sm">Save default</button>
          <span className="w-full text-xs text-neutral-400">
            Used after every working set of this exercise. App default is {DEFAULT_REST_SECONDS}s.
          </span>
        </form>
      </section>

      {exercise.is_custom && options ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Your exercise</h2>
          <form action={updateCustomExercise} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="exerciseId" value={id} />
            <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs text-neutral-500">
              Name
              <input
                name="name"
                required
                defaultValue={exercise.name}
                className="rounded border border-neutral-300 px-2 py-1.5 text-base text-neutral-900"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
              Muscle group
              <select
                name="muscleGroup"
                defaultValue={exercise.muscle_group ?? ""}
                className="rounded border border-neutral-300 px-2 py-1.5 text-base text-neutral-900"
              >
                <option value="">—</option>
                {/* A custom exercise's group is free text when created, so it
                    may not be in the list; keep it selectable or saving would
                    silently clear it. */}
                {[...new Set([...options.muscles, ...(exercise.muscle_group ? [exercise.muscle_group] : [])])]
                  .sort()
                  .map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
              </select>
            </label>
            <button className="rounded border border-neutral-900 px-4 py-2 text-sm">Save</button>
          </form>
          <form action={deleteCustomExercise} className="self-start">
            <input type="hidden" name="exerciseId" value={id} />
            <ConfirmButton
              message={`Delete ${exercise.name}? Only possible while no workout or routine uses it.`}
              className="text-xs text-red-700 underline"
            >
              Delete exercise
            </ConfirmButton>
          </form>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Session history</h2>
        {stats.length === 0 ? (
          <p className="text-sm text-neutral-500">No completed sessions with this exercise yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {/* Newest first here, even though the charts run oldest-first. */}
            {[...stats].reverse().map((s) => (
              <li key={s.sessionId}>
                <Link
                  href={`/workout/${s.sessionId}/summary`}
                  className="flex flex-col rounded border border-neutral-200 px-4 py-3"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{s.date}</span>
                    <span className="text-sm tabular-nums text-neutral-500">
                      {s.volume.toLocaleString()} lb · {s.workingSets} sets
                    </span>
                  </span>
                  <span className="mt-1 text-sm tabular-nums text-neutral-600">
                    {history
                      .filter((h) => h.lift_details_id === s.sessionId)
                      .map((h) => `${h.weight ?? "—"}×${h.reps ?? "—"}${h.set_type === "warmup" ? " (w)" : ""}`)
                      .join(", ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
