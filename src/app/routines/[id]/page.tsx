import Link from "next/link";
import { notFound } from "next/navigation";
import ConfirmButton from "@/components/ConfirmButton";
import LineChart from "@/components/LineChart";
import { getRoutine, getRoutineHistory } from "@/lib/lift/queries";
import { sessionStats } from "@/lib/lift/stats";
import { startWorkoutFromRoutine } from "@/app/workout/actions";
import {
  deleteRoutine,
  moveRoutineExercise,
  removeRoutineExercise,
  renameRoutine,
  updateRoutineExercise,
} from "../actions";

export default async function RoutineDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const routine = await getRoutine(id);
  if (!routine) notFound();

  const stats = sessionStats(await getRoutineHistory(id));

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="min-w-0 truncate text-xl font-semibold">{routine.routine.name}</h1>
        <Link href="/routines" className="shrink-0 text-sm text-neutral-500 underline">
          Routines
        </Link>
      </header>

      <form action={startWorkoutFromRoutine}>
        <input type="hidden" name="routineId" value={id} />
        <button className="w-full rounded bg-neutral-900 px-4 py-3 text-white">
          Start workout from this routine
        </button>
      </form>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Exercises</h2>

        {routine.exercises.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing in this routine yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {routine.exercises.map((re, index) => (
              <li key={re.id} className="rounded border border-neutral-200 px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/exercise/${re.exercise_id}`} className="min-w-0 truncate font-medium hover:underline">
                    {re.exercise.name}
                  </Link>
                  <div className="flex shrink-0 items-center gap-1 text-neutral-400">
                    <MoveButton routineId={id} id={re.id} direction="up" disabled={index === 0} />
                    <MoveButton
                      routineId={id}
                      id={re.id}
                      direction="down"
                      disabled={index === routine.exercises.length - 1}
                    />
                    <form action={removeRoutineExercise}>
                      <input type="hidden" name="routineId" value={id} />
                      <input type="hidden" name="id" value={re.id} />
                      <button className="px-1 hover:text-red-600" aria-label="Remove from routine">
                        ×
                      </button>
                    </form>
                  </div>
                </div>

                {/* Targets save on submit rather than on change, so editing
                    them needs no client-side state. */}
                <form action={updateRoutineExercise} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="routineId" value={id} />
                  <input type="hidden" name="id" value={re.id} />
                  <label className="flex w-20 flex-col gap-0.5 text-xs text-neutral-500">
                    Sets
                    <input
                      name="targetSets"
                      inputMode="numeric"
                      defaultValue={re.target_sets ?? ""}
                      className="rounded border border-neutral-300 px-2 py-1.5 text-base text-neutral-900"
                    />
                  </label>
                  <label className="flex w-20 flex-col gap-0.5 text-xs text-neutral-500">
                    Reps
                    <input
                      name="targetReps"
                      inputMode="numeric"
                      defaultValue={re.target_reps ?? ""}
                      className="rounded border border-neutral-300 px-2 py-1.5 text-base text-neutral-900"
                    />
                  </label>
                  <button className="rounded border border-neutral-300 px-3 py-2 text-sm">Save</button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <Link
          href={`/routines/${id}/add`}
          className="rounded border border-neutral-300 px-4 py-3 text-center"
        >
          Add exercise
        </Link>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Progress</h2>
        <p className="-mt-2 text-sm text-neutral-500">
          Total volume across every completed workout started from this routine — a flattening line
          here is the routine plateauing even when individual lifts still look fine.
        </p>
        <LineChart
          title="Volume per session"
          unit="lb"
          data={stats.map((s) => ({ date: s.date, value: s.volume }))}
          emptyMessage="Complete a workout from this routine to start the chart."
        />
      </section>

      <section className="flex flex-col gap-3 border-t border-neutral-100 pt-6">
        <form action={renameRoutine} className="flex gap-2">
          <input type="hidden" name="routineId" value={id} />
          <input
            name="name"
            required
            defaultValue={routine.routine.name}
            className="min-w-0 flex-1 rounded border border-neutral-300 px-3 py-2 text-base"
          />
          <button className="shrink-0 rounded border border-neutral-300 px-4 py-2 text-sm">Rename</button>
        </form>
        <form action={deleteRoutine} className="self-center">
          <input type="hidden" name="routineId" value={id} />
          <ConfirmButton
            message="Delete this routine? Workouts logged from it are kept."
            className="text-xs text-neutral-400 underline hover:text-red-600"
          >
            Delete routine
          </ConfirmButton>
        </form>
        <p className="text-center text-xs text-neutral-400">
          Deleting a routine keeps every workout logged from it; only the grouping is lost.
        </p>
      </section>
    </main>
  );
}

function MoveButton({
  routineId,
  id,
  direction,
  disabled,
}: {
  routineId: string;
  id: string;
  direction: "up" | "down";
  disabled: boolean;
}) {
  return (
    <form action={moveRoutineExercise}>
      <input type="hidden" name="routineId" value={routineId} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <button
        className="px-1 hover:text-neutral-900 disabled:opacity-30"
        disabled={disabled}
        aria-label={`Move ${direction}`}
      >
        {direction === "up" ? "↑" : "↓"}
      </button>
    </form>
  );
}
