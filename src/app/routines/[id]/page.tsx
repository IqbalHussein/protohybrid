import Link from "next/link";
import { notFound } from "next/navigation";
import { getRoutine, getRoutineProgress } from "@/lib/lift/queries";
import { formatDate } from "@/lib/dates";
import { ConfirmButton } from "@/components/ConfirmButton";
import { LineChart } from "@/components/LineChart";
import { startWorkout } from "../../workout/actions";
import {
  deleteRoutine,
  moveRoutineExercise,
  removeRoutineExercise,
  renameRoutine,
  updateRoutineExercise,
} from "../actions";

export default async function RoutinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [routine, progress] = await Promise.all([getRoutine(id), getRoutineProgress(id)]);
  if (!routine) notFound();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold">{routine.name}</h1>
          <Link href="/routines" className="text-sm text-neutral-500 underline">
            All routines
          </Link>
        </div>
        <form action={startWorkout}>
          <input type="hidden" name="routineId" value={id} />
          <button className="w-full rounded bg-neutral-900 px-4 py-3 text-white">Start workout from this routine</button>
        </form>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Exercises</h2>
        {routine.exercises.length === 0 ? (
          <p className="text-sm text-neutral-500">No exercises yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {routine.exercises.map((re, i) => (
              <li key={re.id} className="flex flex-col gap-2 rounded border border-neutral-200 px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/exercises/${re.exercise.id}`} className="font-medium hover:underline">
                    {re.exercise.name}
                  </Link>
                  <div className="flex gap-1 text-sm">
                    {(["up", "down"] as const).map((direction) => (
                      <form key={direction} action={moveRoutineExercise}>
                        <input type="hidden" name="routineId" value={id} />
                        <input type="hidden" name="id" value={re.id} />
                        <input type="hidden" name="direction" value={direction} />
                        <button
                          disabled={direction === "up" ? i === 0 : i === routine.exercises.length - 1}
                          aria-label={`Move ${direction}`}
                          className="rounded border border-neutral-300 px-2 disabled:opacity-30"
                        >
                          {direction === "up" ? "↑" : "↓"}
                        </button>
                      </form>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <form action={updateRoutineExercise} className="flex items-center gap-2">
                    <input type="hidden" name="routineId" value={id} />
                    <input type="hidden" name="id" value={re.id} />
                    <input
                      name="targetSets"
                      inputMode="numeric"
                      defaultValue={re.target_sets ?? ""}
                      aria-label="Target sets"
                      className="w-14 rounded border border-neutral-300 px-2 py-1"
                    />
                    <span className="text-neutral-400">sets ×</span>
                    <input
                      name="targetReps"
                      inputMode="numeric"
                      defaultValue={re.target_reps ?? ""}
                      aria-label="Target reps"
                      className="w-14 rounded border border-neutral-300 px-2 py-1"
                    />
                    <span className="text-neutral-400">reps</span>
                    <button className="rounded border border-neutral-300 px-2 py-1">Save</button>
                  </form>
                  <form action={removeRoutineExercise} className="ml-auto">
                    <input type="hidden" name="routineId" value={id} />
                    <input type="hidden" name="id" value={re.id} />
                    <button className="text-neutral-400 underline hover:text-red-600">Remove</button>
                  </form>
                </div>
              </li>
            ))}
          </ol>
        )}
        <Link href={`/routines/${id}/add`} className="rounded border border-neutral-300 px-4 py-2.5 text-center">
          Add exercise
        </Link>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Progress</h2>
        <LineChart
          title="Total volume per workout"
          unit=" lb"
          points={progress.map((p) => ({ label: formatDate(p.date, { weekday: undefined }), value: p.volume }))}
        />
        {progress.length ? (
          <ul className="flex flex-col text-sm">
            {[...progress].reverse().map((p) => (
              <li key={p.sessionId} className="flex justify-between border-t border-neutral-100 py-1.5">
                <Link href={`/workout/${p.sessionId}/summary`} className="hover:underline">
                  {formatDate(p.date)}
                </Link>
                <span className="text-neutral-600">{p.volume.toLocaleString()} lb</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 border-t border-neutral-200 pt-4 text-sm">
        <form action={renameRoutine} className="flex gap-2">
          <input type="hidden" name="routineId" value={id} />
          <input name="name" required defaultValue={routine.name} className="flex-1 rounded border border-neutral-300 px-3 py-2 text-base" />
          <button className="rounded border border-neutral-300 px-3 py-2">Rename</button>
        </form>
        <form action={deleteRoutine}>
          <input type="hidden" name="routineId" value={id} />
          <ConfirmButton message="Delete this routine? Past workouts started from it are kept." className="text-red-600 underline">
            Delete routine
          </ConfirmButton>
        </form>
      </section>
    </main>
  );
}
