import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkout } from "@/lib/lift/queries";
import { formatDate } from "@/lib/dates";
import { countsAsWork, formatDuration, setVolume } from "@/lib/lift/math";
import type { PrRecordType } from "@/lib/lift/types";

const PR_LABELS: Record<PrRecordType, string> = {
  heaviest_weight: "Heaviest weight",
  best_e1rm: "Best estimated 1RM",
  most_reps: "Most reps at weight",
  best_volume: "Best set volume",
};

export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workout = await getWorkout(id);
  if (!workout) notFound();
  if (workout.status !== "completed") redirect(`/workout/${id}`);

  const supabase = await createClient();
  const { data: prs } = await supabase
    .from("personal_records")
    .select("id, exercise_id, record_type, value, weight, reps, exercises(name)")
    .eq("session_id", id);

  const workingSets = workout.exercises.flatMap((e) => e.sets).filter((s) => countsAsWork(s.set_type));
  const totalVolume = workingSets.reduce((sum, s) => sum + setVolume(s.weight, s.reps), 0);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold capitalize">{workout.focus}</h1>
          <Link href={`/workout/${id}`} className="text-sm text-neutral-500 underline">
            Edit workout
          </Link>
        </div>
        <p className="text-sm text-neutral-500">{formatDate(workout.plannedDate)}</p>
        {workout.notes ? <p className="whitespace-pre-line text-sm text-neutral-700">{workout.notes}</p> : null}
      </header>

      <dl className="grid grid-cols-3 gap-3 text-center">
        {[
          ["Duration", formatDuration(workout.startedAt, workout.completedAt)],
          ["Working sets", String(workingSets.length)],
          ["Volume", `${totalVolume.toLocaleString()} lb`],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-neutral-200 px-3 py-4">
            <dt className="text-xs uppercase tracking-wide text-neutral-400">{label}</dt>
            <dd className="mt-1 text-lg font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Personal records</h2>
        {!prs?.length ? (
          <p className="text-sm text-neutral-500">No PRs this session.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {prs.map((pr) => {
              const ex = Array.isArray(pr.exercises) ? pr.exercises[0] : pr.exercises;
              return (
                <li
                  key={pr.id}
                  className="flex items-baseline justify-between rounded border border-neutral-200 px-4 py-2.5 text-sm"
                >
                  <Link href={`/exercises/${pr.exercise_id}`} className="font-medium hover:underline">
                    {(ex as { name?: string } | null)?.name}
                  </Link>
                  <span className="text-neutral-600">
                    {PR_LABELS[pr.record_type as PrRecordType]} ·{" "}
                    {Math.round(Number(pr.value) * 10) / 10}
                    {pr.record_type === "most_reps" ? ` reps @ ${pr.weight}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Sets</h2>
        {workout.exercises.map(({ exercise, sets }) => (
          <div key={exercise.id} className="rounded border border-neutral-200 px-4 py-3">
            <Link href={`/exercises/${exercise.id}`} className="font-medium hover:underline">
              {exercise.name}
            </Link>
            <p className="mt-1 text-sm text-neutral-600">
              {sets
                .map((s) => `${s.weight ?? "—"}×${s.reps ?? "—"}${s.set_type === "warmup" ? " (w)" : ""}`)
                .join(", ")}
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}
