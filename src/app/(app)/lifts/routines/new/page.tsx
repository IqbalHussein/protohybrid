import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClass } from "@/components/ui/button";
import { loadExercises, loadRecentExerciseIds } from "../../data";
import { RoutineForm } from "../routine-form";

export default async function NewRoutinePage() {
  const { supabase } = await requireUser();
  const [exercises, suggestedIds] = await Promise.all([loadExercises(supabase), loadRecentExerciseIds(supabase)]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <PageHeader
        title="New routine"
        actions={
          <Link href="/lifts/routines" className={buttonClass("ghost")}>
            Cancel
          </Link>
        }
      />
      <RoutineForm routineId={null} initialName="" initialItems={[]} exercises={exercises} suggestedIds={suggestedIds} />
    </div>
  );
}
