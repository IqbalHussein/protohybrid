import Link from "next/link";
import { getFilterOptions, searchExercises } from "@/lib/lift/queries";
import { UNSPECIFIED_EQUIPMENT } from "@/lib/lift/types";

type Props = {
  title: string;
  backHref: string;
  /** Current filter state, read from the page's search params. */
  query: string;
  muscle: string;
  equipment: string;
  /** Server action run when an exercise is picked, and when a custom one is created. */
  pickAction: (formData: FormData) => Promise<void>;
  createAction: (formData: FormData) => Promise<void>;
  /** Extra hidden inputs both forms need — the session or routine being added to. */
  hidden: Record<string, string>;
};

/**
 * The exercise picker (spec Screens #2), shared by the workout logger and the
 * routine editor. Both need the same search, the same filters and the same
 * "create custom" escape hatch; only the action they submit to differs.
 *
 * A server component on purpose: filters live in the URL as a plain GET form,
 * so search works without JavaScript and every result is rendered server-side.
 */
export default async function ExercisePicker({
  title,
  backHref,
  query,
  muscle,
  equipment,
  pickAction,
  createAction,
  hidden,
}: Props) {
  const [results, options] = await Promise.all([
    searchExercises(query, muscle || undefined, equipment || undefined),
    getFilterOptions(),
  ]);

  const hiddenInputs = Object.entries(hidden).map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold">{title}</h1>
        <Link href={backHref} className="text-sm text-neutral-500 underline">
          Back
        </Link>
      </header>

      <form className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={query}
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
            <form action={pickAction} className="flex items-center justify-between gap-3 py-2.5">
              {hiddenInputs}
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
          Nothing matched{query ? ` “${query}”` : ""}. Create it as a custom exercise below.
        </p>
      ) : null}

      <details className="rounded border border-neutral-200 p-4">
        <summary className="cursor-pointer text-sm font-medium">Create custom exercise</summary>
        <form action={createAction} className="mt-3 flex flex-col gap-2">
          {hiddenInputs}
          <input
            name="name"
            required
            defaultValue={query}
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
