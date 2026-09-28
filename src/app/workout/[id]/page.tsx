import Link from "next/link";
import { notFound } from "next/navigation";
import ConfirmButton from "@/components/ConfirmButton";
import RestTimer from "@/components/RestTimer";
import SetRow from "@/components/SetRow";
import {
  getExercise,
  getPreviousPerformance,
  getRestPreferences,
  getRoutine,
  getWorkout,
} from "@/lib/lift/queries";
import { countsAsWork, formatDuration, setVolume } from "@/lib/lift/math";
import { supersetLabels } from "@/lib/lift/supersets";
import { DEFAULT_REST_SECONDS, SET_TYPE_LABELS, type Exercise, type LiftSet, type SetType } from "@/lib/lift/types";
import {
  addSet,
  deleteWorkout,
  finishWorkout,
  groupWithPrevious,
  saveWorkoutAsRoutine,
  ungroupSuperset,
  updateWorkoutNotes,
} from "../actions";

const SET_TYPES = Object.keys(SET_TYPE_LABELS) as SetType[];

/**
 * Ghost text for the next set: the matching set number from the last session
 * with this exercise, falling back to that session's final set once you go
 * past its length.
 */
function ghostText(previous: LiftSet[], setNumber: number): string {
  const match = previous.find((p) => p.set_number === setNumber) ?? previous[previous.length - 1];
  if (!match || match.weight == null || match.reps == null) return "—";
  return `${match.weight} × ${match.reps}`;
}

export default async function WorkoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ add?: string; rest?: string; at?: string; ex?: string }>;
}) {
  const { id } = await params;
  const { add, rest, at, ex } = await searchParams;

  const workout = await getWorkout(id);
  if (!workout) notFound();

  const isDone = workout.status === "completed";
  const loggedIds = workout.exercises.map((e) => e.exercise.id);

  // Exercises that belong to this workout but have no sets yet: the routine's
  // remaining exercises (a routine-started workout is "pre-filled"), plus
  // whatever the picker just handed back. An exercise only really joins the
  // workout once its first set is logged, so these are render-only.
  const routine = workout.routineId ? await getRoutine(workout.routineId) : null;
  const pending: Exercise[] = (routine?.exercises ?? [])
    .map((r) => r.exercise)
    .filter((e) => !loggedIds.includes(e.id));

  if (add && !loggedIds.includes(add) && !pending.some((p) => p.id === add)) {
    const picked = await getExercise(add);
    if (picked) pending.unshift(picked);
  }

  const allIds = [...loggedIds, ...pending.map((p) => p.id)];
  const previous = Object.fromEntries(
    await Promise.all(allIds.map(async (exId) => [exId, await getPreviousPerformance(exId, id)] as const)),
  );

  const totalVolume = workout.exercises
    .flatMap((e) => e.sets)
    .filter((s) => countsAsWork(s.set_type))
    .reduce((sum, s) => sum + setVolume(s.weight, s.reps), 0);

  const labels = supersetLabels(
    workout.exercises.map((e) => ({ exerciseId: e.exercise.id, supersetGroup: e.supersetGroup })),
  );

  // The rest timer is entirely server-decided; see addSet.
  const parsedRest = Number(rest);
  const restSeconds = Number.isFinite(parsedRest) && parsedRest > 0 ? parsedRest : null;
  // A hand-edited or truncated URL must drop the timer, not crash the page:
  // new Date(NaN).toISOString() throws.
  const restStartMs = Number(at);
  const restStartedAt = at && Number.isFinite(restStartMs) && restStartMs > 0 ? new Date(restStartMs).toISOString() : null;
  const restExercise = ex ? await getExercise(ex) : null;
  const restPrefs = ex ? await getRestPreferences([ex]) : new Map<string, number>();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 pb-40">
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

      {workout.exercises.length === 0 && pending.length === 0 ? (
        <p className="text-sm text-neutral-500">No exercises yet. Add one to start logging sets.</p>
      ) : null}

      {workout.exercises.map(({ exercise, sets, supersetGroup }, index) => (
        <section key={exercise.id} className="flex flex-col gap-2 rounded border border-neutral-200 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-medium">
              <Link href={`/exercise/${exercise.id}`} className="hover:underline">
                {exercise.name}
              </Link>
              {supersetGroup ? (
                <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-normal text-neutral-600">
                  Superset {labels.get(supersetGroup)}
                </span>
              ) : null}
            </h2>
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
                <th className="py-1">RPE</th>
                <th className="py-1">Type</th>
                <th className="w-20 py-1" />
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => (
                <SetRow key={s.id} set={s} sessionId={id} editable={!isDone} />
              ))}
            </tbody>
          </table>

          {isDone ? null : (
            <>
              <SetForm
                sessionId={id}
                exerciseId={exercise.id}
                placeholder={ghostText(previous[exercise.id] ?? [], sets.length + 1)}
              />
              {/* Supersets group an exercise with the one above it, so the
                  first exercise in a workout has nothing to join. */}
              <form action={supersetGroup ? ungroupSuperset : groupWithPrevious} className="self-start">
                <input type="hidden" name="sessionId" value={id} />
                <input type="hidden" name="exerciseId" value={exercise.id} />
                <button
                  className="text-xs text-neutral-400 underline hover:text-neutral-900 disabled:no-underline disabled:opacity-40"
                  disabled={!supersetGroup && index === 0}
                >
                  {supersetGroup ? "Remove from superset" : "Superset with previous"}
                </button>
              </form>
            </>
          )}
        </section>
      ))}

      {isDone
        ? null
        : pending.map((exercise) => (
            <section
              key={exercise.id}
              className="flex flex-col gap-2 rounded border border-dashed border-neutral-300 p-4"
            >
              <h2 className="font-medium">{exercise.name}</h2>
              <p className="text-xs text-neutral-500">
                {routine?.exercises.find((r) => r.exercise_id === exercise.id)
                  ? targetText(routine.exercises.find((r) => r.exercise_id === exercise.id)!)
                  : "Log the first set to add it to this workout."}
              </p>
              <SetForm
                sessionId={id}
                exerciseId={exercise.id}
                placeholder={ghostText(previous[exercise.id] ?? [], 1)}
              />
            </section>
          ))}

      {isDone ? (
        <Link
          href={`/workout/${id}/summary`}
          className="rounded bg-neutral-900 px-4 py-3 text-center text-white"
        >
          View summary
        </Link>
      ) : (
        <div className="flex flex-col gap-3">
          <Link
            href={`/workout/${id}/add`}
            className="rounded border border-neutral-300 px-4 py-3 text-center"
          >
            Add exercise
          </Link>

          <form action={updateWorkoutNotes} className="flex flex-col gap-1.5">
            <input type="hidden" name="sessionId" value={id} />
            <label className="text-xs uppercase tracking-wide text-neutral-400" htmlFor="notes">
              Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              defaultValue={workout.notes ?? ""}
              className="rounded border border-neutral-300 px-3 py-2 text-base"
            />
            <button className="self-start text-xs text-neutral-500 underline">Save notes</button>
          </form>

          <form action={finishWorkout}>
            <input type="hidden" name="sessionId" value={id} />
            <button className="w-full rounded bg-neutral-900 px-4 py-3 text-white">Finish workout</button>
          </form>

          {workout.exercises.length > 0 && !workout.routineId ? (
            <details className="rounded border border-neutral-200 p-4">
              <summary className="cursor-pointer text-sm font-medium">Save as routine</summary>
              <form action={saveWorkoutAsRoutine} className="mt-3 flex gap-2">
                <input type="hidden" name="sessionId" value={id} />
                <input
                  name="name"
                  required
                  defaultValue={workout.focus}
                  className="min-w-0 flex-1 rounded border border-neutral-300 px-3 py-2 text-base"
                />
                <button className="shrink-0 rounded bg-neutral-900 px-4 py-2 text-white">Save</button>
              </form>
            </details>
          ) : null}

          <form action={deleteWorkout} className="self-center">
            <input type="hidden" name="sessionId" value={id} />
            <ConfirmButton
              message="Delete this workout and every set in it? This cannot be undone."
              className="text-xs text-neutral-400 underline hover:text-red-600"
            >
              Delete this workout
            </ConfirmButton>
          </form>
        </div>
      )}

      {restSeconds && restStartedAt && restExercise ? (
        <RestTimer
          /* Keyed on the start time so each logged set mounts a fresh timer
             rather than reusing the previous countdown's state. */
          key={at}
          /* The URL carries the length addSet resolved; re-reading the
             preference here means saving a new default takes effect on the
             next render rather than only on the next set. */
          seconds={restPrefs.get(restExercise.id) ?? restSeconds ?? DEFAULT_REST_SECONDS}
          startedAt={restStartedAt}
          exerciseId={restExercise.id}
          exerciseName={restExercise.name}
        />
      ) : null}
    </main>
  );
}

function targetText(target: { target_sets: number | null; target_reps: number | null }): string {
  if (!target.target_sets && !target.target_reps) return "From your routine.";
  return `Target: ${target.target_sets ?? "?"} × ${target.target_reps ?? "?"}`;
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
          {SET_TYPES.map((t) => (
            <option key={t} value={t}>
              {SET_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <button className="rounded bg-neutral-900 px-3 py-2 text-sm text-white">Log set</button>
      {placeholder !== "—" ? (
        <span className="w-full text-xs text-neutral-400">Last time: {placeholder}</span>
      ) : null}
    </form>
  );
}
