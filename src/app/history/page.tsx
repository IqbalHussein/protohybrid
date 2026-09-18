import Link from "next/link";
import { getWorkoutHistory } from "@/lib/lift/queries";
import { formatDuration } from "@/lib/lift/math";
import { totalVolume } from "@/lib/lift/stats";

export default async function HistoryPage() {
  const workouts = await getWorkoutHistory(100);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold">History</h1>
        <Link href="/" className="text-sm text-neutral-500 underline">
          Home
        </Link>
      </header>

      {workouts.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No completed workouts yet. Your first one will show up here.
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {workouts.map((w) => {
          const sets = w.exercises.flatMap((e) => e.sets);
          return (
            <li key={w.sessionId}>
              {/* Native <details> keeps the whole list a server component —
                  every workout's sets are already loaded, so expanding is
                  instant and costs no request. */}
              <details className="rounded border border-neutral-200 px-4 py-3">
                <summary className="flex cursor-pointer items-baseline justify-between gap-3">
                  <span className="font-medium capitalize">{w.focus}</span>
                  <span className="text-sm tabular-nums text-neutral-500">
                    {w.date} · {formatDuration(w.startedAt, w.completedAt)} ·{" "}
                    {totalVolume(sets).toLocaleString()} lb
                  </span>
                </summary>

                <div className="mt-3 flex flex-col gap-2 border-t border-neutral-100 pt-3">
                  {w.exercises.length === 0 ? (
                    <p className="text-sm text-neutral-500">No sets logged.</p>
                  ) : (
                    w.exercises.map((e) => (
                      <div key={e.name} className="text-sm">
                        <p className="font-medium">{e.name}</p>
                        <p className="tabular-nums text-neutral-600">
                          {e.sets
                            .map(
                              (s) =>
                                `${s.weight ?? "—"}×${s.reps ?? "—"}${s.set_type === "warmup" ? " (w)" : ""}`,
                            )
                            .join(", ")}
                        </p>
                      </div>
                    ))
                  )}
                  <Link
                    href={`/workout/${w.sessionId}/summary`}
                    className="self-start text-xs text-neutral-500 underline"
                  >
                    Open summary
                  </Link>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
