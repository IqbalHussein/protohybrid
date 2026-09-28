import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getActiveWorkout, getWorkoutHistory } from "@/lib/lift/queries";
import { formatDuration } from "@/lib/lift/math";
import { totalVolume } from "@/lib/lift/stats";
import { startWorkout } from "./workout/actions";

const RECENT_LIMIT = 5;

export default async function Home() {
  const { user } = await requireUser();
  const [active, history] = await Promise.all([getActiveWorkout(), getWorkoutHistory(RECENT_LIMIT)]);

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

      <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Link href="/calendar" className="rounded border border-neutral-300 px-4 py-3 text-center">
          Week
        </Link>
        <Link href="/routines" className="rounded border border-neutral-300 px-4 py-3 text-center">
          Routines
        </Link>
        <Link href="/history" className="rounded border border-neutral-300 px-4 py-3 text-center">
          History
        </Link>
        <Link href="/settings" className="rounded border border-neutral-300 px-4 py-3 text-center">
          Settings
        </Link>
      </nav>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-medium">Recent workouts</h2>
          {history.length === RECENT_LIMIT ? (
            <Link href="/history" className="text-sm text-neutral-500 underline">
              All
            </Link>
          ) : null}
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No completed workouts yet. Your first one will show up here.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((w) => (
              <li key={w.sessionId}>
                <Link
                  href={`/workout/${w.sessionId}/summary`}
                  className="flex items-baseline justify-between gap-2 rounded border border-neutral-200 px-4 py-3"
                >
                  <span className="font-medium capitalize">{w.focus}</span>
                  <span className="text-sm tabular-nums text-neutral-500">
                    {w.date} · {formatDuration(w.startedAt, w.completedAt)} ·{" "}
                    {totalVolume(w.exercises.flatMap((e) => e.sets)).toLocaleString()} lb
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
