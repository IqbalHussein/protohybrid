import ExercisePicker from "@/components/ExercisePicker";
import { addRoutineExercise, createCustomExerciseForRoutine } from "../../actions";

export default async function AddExerciseToRoutinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; muscle?: string; equipment?: string }>;
}) {
  const { id } = await params;
  const { q = "", muscle = "", equipment = "" } = await searchParams;

  return (
    <ExercisePicker
      title="Add to routine"
      backHref={`/routines/${id}`}
      query={q}
      muscle={muscle}
      equipment={equipment}
      // Targets are left blank here and edited inline on the routine, so
      // picking several exercises in a row stays one tap each.
      pickAction={addRoutineExercise}
      createAction={createCustomExerciseForRoutine}
      hidden={{ routineId: id }}
    />
  );
}
