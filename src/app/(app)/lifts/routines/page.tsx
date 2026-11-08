import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

type RoutineRow = {
  id: string;
  name: string;
  routine_exercises: { position: number; target_sets: number | null; exercises: { name: string } | null }[];
};

export default async function RoutinesPage() {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("routines")
    .select("id, name, routine_exercises(position, target_sets, exercises(name))")
    .order("name")
    .returns<RoutineRow[]>();
  const routines = data ?? [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <PageHeader
        title="Routines"
        description="Reusable lift templates. Plan a lift from one, or start logging from it."
        actions={
          <>
            <Link href="/lifts" className={buttonClass("ghost")}>
              All lifts
            </Link>
            <Link href="/lifts/routines/new" className={buttonClass("lift")}>
              New routine
            </Link>
          </>
        }
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          Routines couldn&apos;t be loaded: {error.message}
        </p>
      )}
      {!error && routines.length === 0 && (
        <EmptyState
          action={
            <Link href="/lifts/routines/new" className={buttonClass("lift", "sm")}>
              New routine
            </Link>
          }
        >
          No routines yet. Save the exercises you repeat, like a leg day, to plan and log them faster.
        </EmptyState>
      )}
      <ul className="flex flex-col divide-y divide-ink-line">
        {routines.map((r) => {
          const items = [...r.routine_exercises].sort((a, b) => a.position - b.position);
          return (
            <li key={r.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <Link href={`/lifts/routines/${r.id}`} className="stretch-semi font-bold hover:text-lift-strong">
                  {r.name}
                </Link>
                <p className="truncate text-sm text-chalk-muted">
                  {items.map((i) => i.exercises?.name ?? "Exercise").join(", ")}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Link href={`/lifts/routines/${r.id}`} className={buttonClass("ghost", "sm")}>
                  Edit
                </Link>
                <Link href={`/lifts/log?routine=${r.id}`} className={buttonClass("lift", "sm")}>
                  Start lift
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
