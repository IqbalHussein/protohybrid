import { ExercisePicker } from "@/components/ExercisePicker";
import { addExerciseToRoutine } from "../../actions";

export default async function AddRoutineExercisePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; muscle?: string; equipment?: string }>;
}) {
  const { id } = await params;
  return (
    <ExercisePicker
      title="Add exercise to routine"
      backHref={`/routines/${id}`}
      hidden={{ routineId: id }}
      addAction={addExerciseToRoutine}
      query={await searchParams}
    />
  );
}
