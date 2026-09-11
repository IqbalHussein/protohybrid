import Link from "next/link";
import { getActiveWorkout, getWorkoutHistory, requireUser } from "@/lib/lift/queries";
import { formatDuration } from "@/lib/lift/math";
import { startWorkout } from "./workout/actions";

export default async function Home() {
  const { user } = await requireUser();
  const [active, history] = await Promise.all([getActiveWorkout(), getWorkoutHistory()]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-10">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">ProtoHybrid</h1>
        <form action="/auth/signout" method="post">
          <button className="text-sm text-neutral-500 underline">Sign out</button>
        </form>
      </header>
      <p className="-mt-6 text-sm text-neutral-500">{user.email}</p>

      {active ? (
        <Link
          href={`/workout/${active.id}`}
          className="rounded border border-neutral-900 bg-neutral-900 px-4 py-3 text-center text-white"
        >
          Resume workout in progress
        </Link>
      ) : (
        <form action={startWorkout} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Focus
            <input
              name="focus"
              placeholder="push / pull / legs / full-body"
              className="rounded border border-neutral-300 px-3 py-2 text-base"
            />
          </label>
          <button className="rounded bg-neutral-900 px-4 py-3 text-white">Start workout</button>
        </form>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No completed workouts yet. Your first one will show up here.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((s) => {
              const d = Array.isArray(s.lift_details) ? s.lift_details[0] : s.lift_details;
              return (
                <li key={s.id}>
                  <Link
                    href={`/workout/${s.id}/summary`}
                    className="flex items-baseline justify-between rounded border border-neutral-200 px-4 py-3"
                  >
                    <span className="font-medium capitalize">{d?.focus ?? "Workout"}</span>
                    <span className="text-sm text-neutral-500">
                      {s.planned_date} · {formatDuration(d?.started_at ?? null, d?.completed_at ?? null)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
