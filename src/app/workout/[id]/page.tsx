import Link from "next/link";
import { notFound } from "next/navigation";
import { getPreviousPerformance, getWorkout } from "@/lib/lift/queries";
import { countsAsWork, formatDuration, setVolume } from "@/lib/lift/math";
import type { LiftSet, SetType } from "@/lib/lift/types";
import { addSet, deleteSet, finishWorkout } from "../actions";

function ghostText(prev: LiftSet[], setNumber: number): string {
  const match = prev.find((p) => p.set_number === setNumber) ?? prev[prev.length - 1];
  if (!match || match.weight == null || match.reps == null) return "—";
  return `${match.weight} × ${match.reps}`;
}

export default async function WorkoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ add?: string }>;
}) {
  const { id } = await params;
  const { add } = await searchParams;

  const workout = await getWorkout(id);
  if (!workout) notFound();

  // An exercise added via the picker has no sets yet, so it isn't in
  // workout.exercises — surface it as an empty block to log the first set into.
  const exerciseIds = workout.exercises.map((e) => e.exercise.id);
  const pendingId = add && !exerciseIds.includes(add) ? add : null;

  const previous = Object.fromEntries(
    await Promise.all(
      [...exerciseIds, ...(pendingId ? [pendingId] : [])].map(
        async (exId) => [exId, await getPreviousPerformance(exId, id)] as const,
      ),
    ),
  );

  const totalVolume = workout.exercises
    .flatMap((e) => e.sets)
    .filter((s) => countsAsWork(s.set_type))
    .reduce((sum, s) => sum + setVolume(s.weight, s.reps), 0);

  const isDone = workout.status === "completed";

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold capitalize">{workout.focus}</h1>
          <p className="text-sm text-neutral-500">
            {workout.plannedDate} · {formatDuration(workout.startedAt, workout.completedAt)} ·{" "}
            {totalVolume.toLocaleString()} lb volume
          </p>
        </div>
        <Link href="/" className="text-sm text-neutral-500 underline">
          Home
        </Link>
      </header>

      {workout.exercises.length === 0 && !pendingId ? (
        <p className="text-sm text-neutral-500">
          No exercises yet. Add one to start logging sets.
        </p>
      ) : null}

      {workout.exercises.map(({ exercise, sets }) => (
        <section key={exercise.id} className="flex flex-col gap-2 rounded border border-neutral-200 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-medium">{exercise.name}</h2>
            <span className="text-xs uppercase tracking-wide text-neutral-400">
              {exercise.muscle_group ?? "—"}
            </span>
          </div>

          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="w-10 py-1">Set</th>
                <th className="py-1">Weight</th>
                <th className="py-1">Reps</th>
                <th className="py-1">Type</th>
                <th className="w-8 py-1" />
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => (
                <tr key={s.id} className="border-t border-neutral-100">
                  <td className="py-1.5 text-neutral-400">{s.set_number}</td>
                  <td className="py-1.5">{s.weight ?? "—"}</td>
                  <td className="py-1.5">{s.reps ?? "—"}</td>
                  <td className="py-1.5 text-neutral-500">
                    {s.set_type === "working" ? "" : s.set_type}
                  </td>
                  <td className="py-1.5 text-right">
                    {isDone ? null : (
                      <form action={deleteSet}>
                        <input type="hidden" name="sessionId" value={id} />
                        <input type="hidden" name="setId" value={s.id} />
                        <button className="text-neutral-400 hover:text-red-600" aria-label="Delete set">
                          ×
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {isDone ? null : (
            <SetForm
              sessionId={id}
              exerciseId={exercise.id}
              placeholder={ghostText(previous[exercise.id] ?? [], sets.length + 1)}
            />
          )}
        </section>
      ))}

      {pendingId ? (
        <section className="flex flex-col gap-2 rounded border border-dashed border-neutral-300 p-4">
          <h2 className="font-medium">New exercise</h2>
          <p className="text-xs text-neutral-500">Log the first set to add it to this workout.</p>
          <SetForm
            sessionId={id}
            exerciseId={pendingId}
            placeholder={ghostText(previous[pendingId] ?? [], 1)}
          />
        </section>
      ) : null}

      {isDone ? (
        <Link href={`/workout/${id}/summary`} className="rounded bg-neutral-900 px-4 py-3 text-center text-white">
          View summary
        </Link>
      ) : (
        <div className="flex flex-col gap-2">
          <Link
            href={`/workout/${id}/add`}
            className="rounded border border-neutral-300 px-4 py-3 text-center"
          >
            Add exercise
          </Link>
          <form action={finishWorkout}>
            <input type="hidden" name="sessionId" value={id} />
            <button className="w-full rounded bg-neutral-900 px-4 py-3 text-white">
              Finish workout
            </button>
          </form>
        </div>
      )}
    </main>
  );
}

function SetForm({
  sessionId,
  exerciseId,
  placeholder,
}: {
  sessionId: string;
  exerciseId: string;
  placeholder: string;
}) {
  const [prevWeight, prevReps] = placeholder.split(" × ");
  return (
    <form action={addSet} className="flex flex-wrap items-end gap-2 pt-1">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="exerciseId" value={exerciseId} />
      <label className="flex w-20 flex-col gap-0.5 text-xs text-neutral-500">
        Weight
        <input
          name="weight"
          inputMode="decimal"
          placeholder={prevWeight === "—" ? "" : prevWeight}
          className="rounded border border-neutral-300 px-2 py-1.5 text-base text-neutral-900"
        />
      </label>
      <label className="flex w-16 flex-col gap-0.5 text-xs text-neutral-500">
        Reps
        <input
          name="reps"
          inputMode="numeric"
          placeholder={prevReps ?? ""}
          className="rounded border border-neutral-300 px-2 py-1.5 text-base text-neutral-900"
        />
      </label>
      <label className="flex w-16 flex-col gap-0.5 text-xs text-neutral-500">
        RPE
        <input
          name="rpe"
          inputMode="decimal"
          className="rounded border border-neutral-300 px-2 py-1.5 text-base text-neutral-900"
        />
      </label>
      <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
        Type
        <select
          name="setType"
          defaultValue={"working" satisfies SetType}
          className="rounded border border-neutral-300 px-2 py-1.5 text-base text-neutral-900"
        >
          <option value="working">Working</option>
          <option value="warmup">Warm-up</option>
          <option value="drop">Drop</option>
          <option value="failure">Failure</option>
        </select>
      </label>
      <button className="rounded bg-neutral-900 px-3 py-2 text-sm text-white">Log set</button>
      {placeholder !== "—" ? (
        <span className="w-full text-xs text-neutral-400">Last time: {placeholder}</span>
      ) : null}
    </form>
  );
}
