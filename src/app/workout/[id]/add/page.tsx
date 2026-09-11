import Link from "next/link";
import { getFilterOptions, searchExercises } from "@/lib/lift/queries";
import { UNSPECIFIED_EQUIPMENT } from "@/lib/lift/types";
import { addExerciseToWorkout, createCustomExercise } from "../../actions";

export default async function AddExercisePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; muscle?: string; equipment?: string }>;
}) {
  const { id } = await params;
  const { q = "", muscle = "", equipment = "" } = await searchParams;

  const [results, options] = await Promise.all([
    searchExercises(q, muscle || undefined, equipment || undefined),
    getFilterOptions(),
  ]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold">Add exercise</h1>
        <Link href={`/workout/${id}`} className="text-sm text-neutral-500 underline">
          Back
        </Link>
      </header>

      {/* GET form so filters live in the URL and the page stays a server component. */}
      <form className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search exercises"
          className="min-w-40 flex-1 rounded border border-neutral-300 px-3 py-2 text-base"
        />
        <select
          name="muscle"
          defaultValue={muscle}
          className="rounded border border-neutral-300 px-2 py-2 text-base"
        >
          <option value="">All muscles</option>
          {options.muscles.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          name="equipment"
          defaultValue={equipment}
          className="rounded border border-neutral-300 px-2 py-2 text-base"
        >
          <option value="">All equipment</option>
          {options.equipment.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
          {/* 77 seeded rows have no equipment; this keeps them reachable
              rather than invisible behind every equipment filter. */}
          {options.hasUnspecifiedEquipment ? (
            <option value="__unspecified__">{UNSPECIFIED_EQUIPMENT}</option>
          ) : null}
        </select>
        <button className="rounded border border-neutral-900 px-4 py-2">Search</button>
      </form>

      <ul className="flex flex-col divide-y divide-neutral-100">
        {results.map((ex) => (
          <li key={ex.id}>
            <form action={addExerciseToWorkout} className="flex items-center justify-between gap-3 py-2.5">
              <input type="hidden" name="sessionId" value={id} />
              <input type="hidden" name="exerciseId" value={ex.id} />
              <div className="min-w-0">
                <p className="truncate">{ex.name}</p>
                <p className="text-xs text-neutral-400">
                  {ex.muscle_group ?? "—"} · {ex.equipment ?? UNSPECIFIED_EQUIPMENT}
                  {ex.is_custom ? " · custom" : ""}
                </p>
              </div>
              <button className="shrink-0 rounded border border-neutral-300 px-3 py-1.5 text-sm">
                Add
              </button>
            </form>
          </li>
        ))}
      </ul>

      {results.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Nothing matched{q ? ` “${q}”` : ""}. Create it as a custom exercise below.
        </p>
      ) : null}

      <details className="rounded border border-neutral-200 p-4">
        <summary className="cursor-pointer text-sm font-medium">Create custom exercise</summary>
        <form action={createCustomExercise} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="sessionId" value={id} />
          <input
            name="name"
            required
            defaultValue={q}
            placeholder="Exercise name"
            className="rounded border border-neutral-300 px-3 py-2 text-base"
          />
          <select name="muscleGroup" className="rounded border border-neutral-300 px-2 py-2 text-base">
            <option value="">Muscle group (optional)</option>
            {options.muscles.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button className="rounded bg-neutral-900 px-4 py-2 text-white">Create and add</button>
        </form>
      </details>
    </main>
  );
}
