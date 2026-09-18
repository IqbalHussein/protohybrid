import Link from "next/link";
import { notFound } from "next/navigation";
import ConfirmButton from "@/components/ConfirmButton";
import { getWorkout } from "@/lib/lift/queries";
import { formatDuration, roundTo } from "@/lib/lift/math";
import { totalVolume } from "@/lib/lift/stats";
import { PR_LABELS, type PrRecordType } from "@/lib/lift/types";
import { createClient } from "@/lib/supabase/server";
import { deleteWorkout, saveWorkoutAsRoutine } from "../../actions";

export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workout = await getWorkout(id);
  if (!workout) notFound();

  // PRs are read by session rather than by exercise here — this view answers
  // "what did this workout break", not "what is the record".
  const supabase = await createClient();
  const { data: prs } = await supabase
    .from("personal_records")
    .select("id, record_type, value, weight, reps, exercise_id, exercises(name)")
    .eq("session_id", id);

  const sets = workout.exercises.flatMap((e) => e.sets);
  const workingSets = sets.filter((s) => s.set_type !== "warmup");

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold capitalize">{workout.focus}</h1>
          <p className="text-sm text-neutral-500">{workout.plannedDate}</p>
        </div>
        <Link href="/" className="text-sm text-neutral-500 underline">
          Home
        </Link>
      </header>

      <dl className="grid grid-cols-3 gap-3 text-center">
        {[
          ["Duration", formatDuration(workout.startedAt, workout.completedAt)],
          ["Working sets", String(workingSets.length)],
          ["Volume", `${totalVolume(sets).toLocaleString()} lb`],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-neutral-200 px-3 py-4">
            <dt className="text-xs uppercase tracking-wide text-neutral-400">{label}</dt>
            <dd className="mt-1 text-lg font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {workout.notes ? (
        <p className="rounded border border-neutral-200 px-4 py-3 text-sm text-neutral-600">
          {workout.notes}
        </p>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Personal records</h2>
        {!prs?.length ? (
          <p className="text-sm text-neutral-500">No PRs this session.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {prs.map((pr) => {
              const exercise = Array.isArray(pr.exercises) ? pr.exercises[0] : pr.exercises;
              return (
                <li key={pr.id}>
                  <Link
                    href={`/exercise/${pr.exercise_id}`}
                    className="flex items-baseline justify-between gap-2 rounded border border-neutral-200 px-4 py-2.5 text-sm"
                  >
                    <span className="font-medium">{(exercise as { name?: string } | null)?.name}</span>
                    <span className="tabular-nums text-neutral-600">
                      {PR_LABELS[pr.record_type as PrRecordType]} · {roundTo(Number(pr.value)).toLocaleString()}
                      {pr.record_type === "most_reps" ? ` reps @ ${pr.weight}` : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Sets</h2>
        {workout.exercises.map(({ exercise, sets: exerciseSets }) => (
          <Link
            key={exercise.id}
            href={`/exercise/${exercise.id}`}
            className="rounded border border-neutral-200 px-4 py-3"
          >
            <p className="font-medium">{exercise.name}</p>
            <p className="mt-1 text-sm tabular-nums text-neutral-600">
              {exerciseSets
                .map((s) => `${s.weight ?? "—"}×${s.reps ?? "—"}${s.set_type === "warmup" ? " (w)" : ""}`)
                .join(", ")}
            </p>
          </Link>
        ))}
      </section>

      <div className="flex flex-col gap-3 border-t border-neutral-100 pt-6">
        {workout.routineId ? (
          <Link
            href={`/routines/${workout.routineId}`}
            className="rounded border border-neutral-300 px-4 py-3 text-center"
          >
            View routine progress
          </Link>
        ) : workout.exercises.length > 0 ? (
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

        <Link href={`/workout/${id}`} className="text-center text-sm text-neutral-500 underline">
          Reopen the set list
        </Link>

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
    </main>
  );
}
