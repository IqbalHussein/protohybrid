import Link from "next/link";
import { getLoggedExercises, searchExercises } from "@/lib/lift/queries";
import { UNSPECIFIED_EQUIPMENT } from "@/lib/lift/types";
import { createCustomExercise } from "../workout/actions";

export default async function ExercisesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const [logged, results] = await Promise.all([getLoggedExercises(), q ? searchExercises(q) : Promise.resolve([])]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">Exercises</h1>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search the exercise library"
          className="flex-1 rounded border border-neutral-300 px-3 py-2 text-base"
        />
        <button className="rounded border border-neutral-900 px-4 py-2">Search</button>
      </form>

      {q ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Results</h2>
          {results.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing matched “{q}”.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-neutral-100">
              {results.map((ex) => (
                <li key={ex.id}>
                  <Link href={`/exercises/${ex.id}`} className="block py-2.5">
                    <p>{ex.name}</p>
                    <p className="text-xs text-neutral-400">
                      {ex.muscle_group ?? "—"} · {ex.equipment ?? UNSPECIFIED_EQUIPMENT}
                      {ex.is_custom ? " · custom" : ""}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Your exercises</h2>
        {logged.length === 0 ? (
          <p className="text-sm text-neutral-500">Exercises you log will show up here with their history.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-100">
            {logged.map(({ exercise, lastUsed, sets }) => (
              <li key={exercise.id}>
                <Link href={`/exercises/${exercise.id}`} className="flex items-baseline justify-between gap-3 py-2.5">
                  <span>{exercise.name}</span>
                  <span className="shrink-0 text-xs text-neutral-400">
                    {sets} sets · last {lastUsed.slice(0, 10)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="rounded border border-neutral-200 p-4">
        <summary className="cursor-pointer text-sm font-medium">Create custom exercise</summary>
        <form action={createCustomExercise} className="mt-3 flex flex-col gap-2">
          <input name="name" required defaultValue={q} placeholder="Exercise name" className="rounded border border-neutral-300 px-3 py-2 text-base" />
          <input name="muscleGroup" placeholder="Muscle group (optional)" className="rounded border border-neutral-300 px-3 py-2 text-base" />
          <input name="equipment" placeholder="Equipment (optional)" className="rounded border border-neutral-300 px-3 py-2 text-base" />
          <button className="rounded bg-neutral-900 px-4 py-2 text-white">Create</button>
        </form>
      </details>
    </main>
  );
}
