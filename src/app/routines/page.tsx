import Link from "next/link";
import { getRoutines } from "@/lib/lift/queries";
import { createRoutine } from "./actions";
import { startWorkoutFromRoutine } from "../workout/actions";

export default async function RoutinesPage() {
  const routines = await getRoutines();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold">Routines</h1>
        <Link href="/" className="text-sm text-neutral-500 underline">
          Home
        </Link>
      </header>

      <p className="-mt-3 text-sm text-neutral-500">
        A routine is an exercise list with set and rep targets — no weights. Start a workout from
        one to pre-fill it and to track that routine&rsquo;s volume over time.
      </p>

      {routines.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No routines yet. Create one below, or finish a workout and save it as a routine.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {routines.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded border border-neutral-200 px-4 py-3"
            >
              <Link href={`/routines/${r.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.name}</p>
                <p className="text-xs text-neutral-400">
                  {r.exerciseCount} {r.exerciseCount === 1 ? "exercise" : "exercises"}
                </p>
              </Link>
              <form action={startWorkoutFromRoutine}>
                <input type="hidden" name="routineId" value={r.id} />
                <button className="shrink-0 rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
                  Start
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={createRoutine} className="flex gap-2">
        <input
          name="name"
          required
          placeholder="New routine name"
          className="min-w-0 flex-1 rounded border border-neutral-300 px-3 py-2 text-base"
        />
        <button className="shrink-0 rounded border border-neutral-900 px-4 py-2">Create</button>
      </form>
    </main>
  );
}
