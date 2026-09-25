import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentRecords, getExercise, getExerciseHistory, getRestSeconds } from "@/lib/lift/queries";
import { getSettings } from "@/lib/settings";
import { formatDate } from "@/lib/dates";
import { UNSPECIFIED_EQUIPMENT, type PrRecordType } from "@/lib/lift/types";
import { ConfirmButton } from "@/components/ConfirmButton";
import { LineChart } from "@/components/LineChart";
import { setRestSeconds } from "../../workout/actions";
import { deleteCustomExercise, updateCustomExercise } from "../actions";

const PR_LABELS: Record<PrRecordType, string> = {
  heaviest_weight: "Heaviest weight",
  best_e1rm: "Best est. 1RM",
  most_reps: "Most reps",
  best_volume: "Best set volume",
};

const round = (n: number) => Math.round(n * 10) / 10;

export default async function ExercisePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [exercise, history, records, rest, settings] = await Promise.all([
    getExercise(id),
    getExerciseHistory(id),
    getCurrentRecords(id),
    getRestSeconds([id]),
    getSettings(),
  ]);
  if (!exercise) notFound();

  const label = (date: string) => formatDate(date, { weekday: undefined });

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-xl font-semibold">{exercise.name}</h1>
        <p className="text-sm text-neutral-500">
          {exercise.muscle_group ?? "—"} · {exercise.equipment ?? UNSPECIFIED_EQUIPMENT}
          {exercise.is_custom ? " · custom" : ""}
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.keys(PR_LABELS) as PrRecordType[]).map((type) => {
          const r = records.get(type);
          return (
            <div key={type} className="rounded border border-neutral-200 px-3 py-3">
              <p className="text-xs uppercase tracking-wide text-neutral-400">{PR_LABELS[type]}</p>
              <p className="mt-1 text-lg font-medium">
                {r ? (type === "most_reps" ? `${r.reps} @ ${r.weight}` : `${round(Number(r.value))}`) : "—"}
              </p>
              {r ? <p className="text-xs text-neutral-400">{r.achieved_at.slice(0, 10)}</p> : null}
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-6">
        <LineChart title="Heaviest weight" unit=" lb" points={history.map((p) => ({ label: label(p.date), value: p.heaviest }))} />
        <LineChart title="Best estimated 1RM" unit=" lb" points={history.map((p) => ({ label: label(p.date), value: p.bestE1rm }))} />
        <LineChart title="Volume per session" unit=" lb" points={history.map((p) => ({ label: label(p.date), value: p.volume }))} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-neutral-500">No completed workouts with this exercise yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...history].reverse().map((p) => (
              <li key={p.sessionId} className="rounded border border-neutral-200 px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <Link href={`/workout/${p.sessionId}/summary`} className="font-medium hover:underline">
                    {formatDate(p.date)}
                  </Link>
                  <span className="text-xs text-neutral-500">{p.volume.toLocaleString()} lb</span>
                </div>
                <p className="mt-1 text-sm text-neutral-600">
                  {p.sets
                    .map((s) => `${s.weight ?? "—"}×${s.reps ?? "—"}${s.set_type === "warmup" ? " (w)" : ""}${s.rpe != null ? ` @${s.rpe}` : ""}`)
                    .join(", ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-neutral-200 pt-4 text-sm">
        <form action={setRestSeconds} className="flex items-center gap-2">
          <input type="hidden" name="exerciseId" value={id} />
          <input type="hidden" name="path" value={`/exercises/${id}`} />
          <label className="flex items-center gap-2">
            Rest timer (seconds)
            <input
              name="restSeconds"
              inputMode="numeric"
              defaultValue={rest[id] ?? ""}
              placeholder={`${settings.default_rest_seconds} (default)`}
              className="w-32 rounded border border-neutral-300 px-2 py-1.5"
            />
          </label>
          <button className="rounded border border-neutral-300 px-3 py-1.5">Save</button>
        </form>

        {exercise.is_custom ? (
          <>
            <form action={updateCustomExercise} className="flex flex-wrap gap-2">
              <input type="hidden" name="exerciseId" value={id} />
              <input name="name" required defaultValue={exercise.name} className="flex-1 rounded border border-neutral-300 px-3 py-2" />
              <input name="muscleGroup" defaultValue={exercise.muscle_group ?? ""} placeholder="Muscle group" className="w-36 rounded border border-neutral-300 px-3 py-2" />
              <input name="equipment" defaultValue={exercise.equipment ?? ""} placeholder="Equipment" className="w-36 rounded border border-neutral-300 px-3 py-2" />
              <button className="rounded border border-neutral-300 px-3 py-2">Save</button>
            </form>
            <form action={deleteCustomExercise}>
              <input type="hidden" name="exerciseId" value={id} />
              <ConfirmButton message="Delete this custom exercise?" className="text-red-600 underline">
                Delete exercise
              </ConfirmButton>
            </form>
          </>
        ) : null}
      </section>
    </main>
  );
}
