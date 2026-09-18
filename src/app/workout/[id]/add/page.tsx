import ExercisePicker from "@/components/ExercisePicker";
import { addExerciseToWorkout, createCustomExercise } from "../../actions";

export default async function AddExerciseToWorkoutPage({
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
      title="Add exercise"
      backHref={`/workout/${id}`}
      query={q}
      muscle={muscle}
      equipment={equipment}
      pickAction={addExerciseToWorkout}
      createAction={createCustomExercise}
      hidden={{ sessionId: id }}
    />
  );
}
