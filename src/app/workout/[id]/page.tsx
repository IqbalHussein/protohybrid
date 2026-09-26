import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getPreviousPerformance,
  getRestSeconds,
  getRoutine,
  getWorkout,
  type RoutineExercise,
} from "@/lib/lift/queries";
import { getSettings } from "@/lib/settings";
import { countsAsWork, formatDuration, setVolume } from "@/lib/lift/math";
import { formatDate } from "@/lib/dates";
import type { Exercise, LiftSet } from "@/lib/lift/types";
import { ConfirmButton } from "@/components/ConfirmButton";
import { RestTimer } from "@/components/RestTimer";
import { SetForm, SetRow } from "@/components/SetForms";
import {
  deleteWorkout,
  discardWorkout,
  finishWorkout,
  removeExerciseFromWorkout,
  saveWorkoutAsRoutine,
  setRestSeconds,
  updateWorkoutDetails,
} from "../actions";

function previousFor(prev: LiftSet[], setNumber: number) {
  const working = prev.filter((p) => countsAsWork(p.set_type));
  const pool = working.length ? working : prev;
  return pool.find((p) => p.set_number === setNumber) ?? pool[pool.length - 1] ?? null;
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
  // A planned session that hasn't been started yet is started from its
  // session page, which stamps started_at.
  if (workout.status !== "completed" && !workout.startedAt) redirect(`/sessions/${id}`);

  const [settings, routine] = await Promise.all([
    getSettings(),
    workout.routineId ? getRoutine(workout.routineId) : null,
  ]);

  const logged = workout.exercises;
  const loggedIds = new Set(logged.map((e) => e.exercise.id));
  const targets = new Map<string, RoutineExercise>((routine?.exercises ?? []).map((re) => [re.exercise.id, re]));

  // Exercises with no sets yet: the routine's remaining ones, plus one just
  // picked via ?add= (an exercise joins a workout by logging its first set).
  const pending: Exercise[] = (routine?.exercises ?? [])
    .map((re) => re.exercise)
    .filter((ex) => !loggedIds.has(ex.id));
  let addedId: string | null = null;
  if (add && !loggedIds.has(add) && !pending.some((ex) => ex.id === add)) addedId = add;

  const allIds = [...loggedIds, ...pending.map((e) => e.id), ...(addedId ? [addedId] : [])];
  const [previousEntries, rest] = await Promise.all([
    Promise.all(allIds.map(async (exId) => [exId, await getPreviousPerformance(exId, id)] as const)),
    getRestSeconds(allIds),
  ]);
  const previous = Object.fromEntries(previousEntries);
  const restFor = (exId: string) => rest[exId] ?? settings.default_rest_seconds;

  const totalVolume = logged
    .flatMap((e) => e.sets)
    .filter((s) => countsAsWork(s.set_type))
    .reduce((sum, s) => sum + setVolume(s.weight, s.reps), 0);

  const isDone = workout.status === "completed";
  const inProgress = !isDone && workout.startedAt != null;
  const path = `/workout/${id}`;

  const exerciseBlock = (exercise: Exercise | null, exerciseId: string, sets: LiftSet[], dashed = false) => {
    const target = targets.get(exerciseId);
    const prev = previousFor(previous[exerciseId] ?? [], sets.length + 1);
    return (
      <section
        key={exerciseId}
        className={`flex flex-col gap-2 rounded border p-4 ${dashed ? "border-dashed border-neutral-300" : "border-neutral-200"}`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-medium">
            {exercise ? (
              <Link href={`/exercises/${exercise.id}`} className="hover:underline">
                {exercise.name}
              </Link>
            ) : (
              "New exercise"
            )}
          </h2>
          <span className="text-xs uppercase tracking-wide text-neutral-400">
            {target ? `Target ${target.target_sets ?? "?"} × ${target.target_reps ?? "?"}` : exercise?.muscle_group ?? ""}
          </span>
        </div>

        {sets.length ? (
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
                <SetRow key={s.id} set={s} sessionId={id} editable />
              ))}
            </tbody>
          </table>
        ) : !exercise ? (
          <p className="text-xs text-neutral-500">Log the first set to add it to this workout.</p>
        ) : null}

        <SetForm
          sessionId={id}
          exerciseId={exerciseId}
          prevWeight={prev?.weight ?? null}
          prevReps={prev?.reps ?? null}
          restSeconds={inProgress ? restFor(exerciseId) : null}
          showRpe={sets.some((s) => s.rpe != null)}
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-500">
          <details>
            <summary className="cursor-pointer">Rest {restFor(exerciseId)}s</summary>
            <form action={setRestSeconds} className="mt-1 flex items-center gap-2">
              <input type="hidden" name="exerciseId" value={exerciseId} />
              <input type="hidden" name="path" value={path} />
              <input
                name="restSeconds"
                inputMode="numeric"
                defaultValue={rest[exerciseId] ?? ""}
                placeholder={`${settings.default_rest_seconds} (default)`}
                className="w-28 rounded border border-neutral-300 px-2 py-1 text-sm"
              />
              <button className="rounded border border-neutral-300 px-2 py-1">Save</button>
            </form>
          </details>
          {sets.length ? (
            <form action={removeExerciseFromWorkout}>
              <input type="hidden" name="sessionId" value={id} />
              <input type="hidden" name="exerciseId" value={exerciseId} />
              <ConfirmButton message="Remove this exercise and all its sets from the workout?" className="underline hover:text-red-600">
                Remove exercise
              </ConfirmButton>
            </form>
          ) : null}
        </div>
      </section>
    );
  };

  return (
    <main className={`mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 ${inProgress ? "pb-28" : ""}`}>
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold capitalize">{workout.focus}</h1>
          {workout.adHoc ? null : (
            <Link href={`/sessions/${id}`} className="text-sm text-neutral-500 underline">
              Session
            </Link>
          )}
        </div>
        <p className="text-sm text-neutral-500">
          {formatDate(workout.plannedDate)} · {formatDuration(workout.startedAt, workout.completedAt)} ·{" "}
          {totalVolume.toLocaleString()} lb volume
          {routine ? (
            <>
              {" "}
              · from{" "}
              <Link href={`/routines/${routine.id}`} className="underline">
                {routine.name}
              </Link>
            </>
          ) : null}
        </p>
        <details className="text-sm">
          <summary className="cursor-pointer text-neutral-500">Edit name / notes</summary>
          <form action={updateWorkoutDetails} className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="sessionId" value={id} />
            <input name="focus" defaultValue={workout.focus} className="rounded border border-neutral-300 px-3 py-2 text-base" />
            <textarea
              name="notes"
              defaultValue={workout.notes ?? ""}
              placeholder="Notes"
              rows={2}
              className="rounded border border-neutral-300 px-3 py-2 text-base"
            />
            <button className="self-start rounded border border-neutral-300 px-3 py-1.5">Save</button>
          </form>
        </details>
      </header>

      {isDone ? (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This workout is finished. Changes to its sets recalculate your PRs.
        </p>
      ) : null}

      {logged.length === 0 && pending.length === 0 && !addedId ? (
        <p className="text-sm text-neutral-500">No exercises yet. Add one to start logging sets.</p>
      ) : null}

      {logged.map(({ exercise, sets }) => exerciseBlock(exercise, exercise.id, sets))}
      {pending.map((ex) => exerciseBlock(ex, ex.id, [], true))}
      {addedId ? exerciseBlock(null, addedId, [], true) : null}

      <div className="flex flex-col gap-2">
        <Link href={`/workout/${id}/add`} className="rounded border border-neutral-300 px-4 py-3 text-center">
          Add exercise
        </Link>
        {isDone ? (
          <Link href={`/workout/${id}/summary`} className="rounded bg-neutral-900 px-4 py-3 text-center text-white">
            View summary
          </Link>
        ) : (
          <form action={finishWorkout}>
            <input type="hidden" name="sessionId" value={id} />
            <button className="w-full rounded bg-neutral-900 px-4 py-3 text-white">Finish workout</button>
          </form>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-neutral-200 pt-4 text-sm">
        {logged.length ? (
          <details>
            <summary className="cursor-pointer text-neutral-600">Save as routine</summary>
            <form action={saveWorkoutAsRoutine} className="mt-2 flex gap-2">
              <input type="hidden" name="sessionId" value={id} />
              <input
                name="name"
                required
                defaultValue={routine ? "" : workout.focus}
                placeholder="Routine name"
                className="flex-1 rounded border border-neutral-300 px-3 py-2 text-base"
              />
              <button className="rounded border border-neutral-300 px-3 py-2">Save</button>
            </form>
          </details>
        ) : null}
        {isDone ? (
          <form action={deleteWorkout}>
            <input type="hidden" name="sessionId" value={id} />
            <ConfirmButton message="Delete this workout and all of its sets? This can't be undone." className="text-red-600 underline">
              Delete workout
            </ConfirmButton>
          </form>
        ) : (
          <form action={discardWorkout}>
            <input type="hidden" name="sessionId" value={id} />
            <ConfirmButton
              message={
                workout.adHoc
                  ? "Discard this workout and everything logged in it?"
                  : "Discard what you've logged? The planned session stays on your calendar."
              }
              className="text-red-600 underline"
            >
              Discard workout
            </ConfirmButton>
          </form>
        )}
      </div>

      {inProgress ? <RestTimer /> : null}
    </main>
  );
}
