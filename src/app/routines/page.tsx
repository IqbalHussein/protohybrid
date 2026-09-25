import Link from "next/link";
import { getRoutines } from "@/lib/lift/queries";
import { startWorkout } from "../workout/actions";
import { createRoutine } from "./actions";

export default async function RoutinesPage() {
  const routines = await getRoutines();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">Routines</h1>

      {routines.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No routines yet. Create one here, or finish a workout and save it as a routine.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {routines.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 rounded border border-neutral-200 px-4 py-3">
              <Link href={`/routines/${r.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.name}</p>
                <p className="text-xs text-neutral-500">
                  {r.exerciseCount} exercise{r.exerciseCount === 1 ? "" : "s"}
                </p>
              </Link>
              <form action={startWorkout}>
                <input type="hidden" name="routineId" value={r.id} />
                <button className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">Start</button>
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
          className="flex-1 rounded border border-neutral-300 px-3 py-2 text-base"
        />
        <button className="rounded border border-neutral-900 px-4 py-2">Create</button>
      </form>
    </main>
  );
}
