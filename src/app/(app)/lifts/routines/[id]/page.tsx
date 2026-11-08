import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/lifts";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClass } from "@/components/ui/button";
import { deleteRoutine } from "../../actions";
import { ConfirmSubmit } from "../../confirm-submit";
import { loadExercises, loadRecentExerciseIds } from "../../data";
import { RoutineForm } from "../routine-form";

export default async function EditRoutinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { supabase } = await requireUser();
  const { data: routine } = await supabase.from("routines").select("id, name").eq("id", id).maybeSingle();
  if (!routine) notFound();

  const [{ data: items }, exercises, suggestedIds] = await Promise.all([
    supabase
      .from("routine_exercises")
      .select("exercise_id, target_sets, target_reps")
      .eq("routine_id", id)
      .order("position"),
    loadExercises(supabase),
    loadRecentExerciseIds(supabase),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <PageHeader
        title="Edit routine"
        actions={
          <>
            <Link href="/lifts/routines" className={buttonClass("ghost")}>
              Cancel
            </Link>
            <Link href={`/lifts/log?routine=${id}`} className={buttonClass("secondary")}>
              Start lift
            </Link>
          </>
        }
      />
      <RoutineForm
        routineId={routine.id}
        initialName={routine.name}
        initialItems={(items ?? []).map((i) => ({
          exerciseId: i.exercise_id,
          targetSets: i.target_sets != null ? String(i.target_sets) : "",
          targetReps: i.target_reps != null ? String(i.target_reps) : "",
        }))}
        exercises={exercises}
        suggestedIds={suggestedIds}
      />
      <form action={deleteRoutine} className="border-t border-ink-line pt-6">
        <input type="hidden" name="routine_id" value={routine.id} />
        <ConfirmSubmit
          confirmMessage="Delete this routine? Lifts planned from it stay on your calendar."
          pendingLabel="Deleting…"
        >
          Delete routine
        </ConfirmSubmit>
      </form>
    </div>
  );
}
