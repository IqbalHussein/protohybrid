import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getTimeZone, getWeightUnit } from "@/lib/settings";
import { formatDateLabel, todayIn } from "@/lib/time";
import { displayWeight } from "@/lib/units";
import { groupByExercise, isUuid } from "@/lib/lifts";
import type { LiftSet, RoutineExercise, SetType } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClass } from "@/components/ui/button";
import { loadExercises, loadRecentExerciseIds, loadRestPrefs } from "../data";
import { LiftForm, type InitialGroup, type LiftFormInitial } from "./lift-form";

type SessionRow = {
  id: string;
  type: string;
  status: string;
  planned_date: string;
  routine_id: string | null;
  lift_details: { focus: string; notes: string | null } | null;
};

function routineGroups(items: Pick<RoutineExercise, "exercise_id" | "target_sets" | "target_reps">[]): InitialGroup[] {
  return items.map((r) => ({
    exerciseId: r.exercise_id,
    sets: Array.from({ length: Math.max(1, r.target_sets ?? 1) }, () => ({
      setType: "working" as SetType,
      reps: r.target_reps != null ? String(r.target_reps) : "",
      weight: "",
      rpe: "",
    })),
  }));
}

// One form, three starting points:
//   ?session=<id>  complete a planned lift (pre-filled from its routine)
//   ?edit=<id>     edit a lift already logged (weights shown in the user's unit)
//   ?routine=<id>  log a new lift starting from a routine
// With none of these it starts blank. All of them save through log_lift.
export default async function LogLiftPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; edit?: string; routine?: string }>;
}) {
  const params = await searchParams;
  const { supabase, user } = await requireUser();
  const [unit, tz, exercises, restPrefs, suggestedIds] = await Promise.all([
    getWeightUnit(supabase, user.id),
    getTimeZone(),
    loadExercises(supabase),
    loadRestPrefs(supabase),
    loadRecentExerciseIds(supabase),
  ]);

  const sessionParam = params.edit ?? params.session;
  let initial: LiftFormInitial = { sessionId: null, date: todayIn(tz), focus: "full-body", notes: "", groups: [] };
  let title = "Log a lift";
  let submitLabel = "Save lift";
  let context: string | null = null;

  const loadRoutine = async (routineId: string) => {
    const { data: routine } = await supabase.from("routines").select("id, name").eq("id", routineId).maybeSingle();
    if (!routine) return null;
    const { data: items } = await supabase
      .from("routine_exercises")
      .select("exercise_id, target_sets, target_reps")
      .eq("routine_id", routineId)
      .order("position");
    return { name: routine.name as string, groups: routineGroups(items ?? []) };
  };

  if (sessionParam) {
    if (!isUuid(sessionParam)) notFound();
    const { data: session } = await supabase
      .from("sessions")
      .select("id, type, status, planned_date, routine_id, lift_details(focus, notes)")
      .eq("id", sessionParam)
      .maybeSingle<SessionRow>();
    if (!session || session.type !== "lift") notFound();

    const { data: sets } = await supabase
      .from("lift_sets")
      .select("exercise_id, set_number, set_type, reps, weight, rpe, created_at")
      .eq("lift_details_id", session.id)
      .order("created_at")
      .order("set_number")
      .returns<Pick<LiftSet, "exercise_id" | "set_number" | "set_type" | "reps" | "weight" | "rpe" | "created_at">[]>();

    let groups: InitialGroup[] = groupByExercise(sets ?? []).map((g) => ({
      exerciseId: g.exercise_id,
      sets: g.sets.map((s) => ({
        setType: s.set_type,
        reps: s.reps != null ? String(s.reps) : "",
        weight: s.weight != null ? String(displayWeight(Number(s.weight), unit)) : "",
        rpe: s.rpe != null ? String(Number(s.rpe)) : "",
        original:
          s.weight != null
            ? { shown: String(displayWeight(Number(s.weight), unit)), lb: Number(s.weight) }
            : undefined,
      })),
    }));

    let routineName: string | null = null;
    if (groups.length === 0 && session.routine_id) {
      const routine = await loadRoutine(session.routine_id);
      if (routine) {
        groups = routine.groups;
        routineName = routine.name;
      }
    }

    initial = {
      sessionId: session.id,
      date: session.planned_date,
      focus: session.lift_details?.focus ?? "full-body",
      notes: session.lift_details?.notes ?? "",
      groups,
    };
    if (session.status === "completed") {
      title = "Edit lift";
      context = `Logged for ${formatDateLabel(session.planned_date)}.`;
    } else {
      title = "Log planned lift";
      submitLabel = "Complete lift";
      context = `Planned for ${formatDateLabel(session.planned_date)}${routineName ? ` from ${routineName}` : ""}. If you did it on another day, change the date.`;
    }
  } else if (params.routine) {
    if (!isUuid(params.routine)) notFound();
    const routine = await loadRoutine(params.routine);
    if (!routine) notFound();
    initial = { ...initial, groups: routine.groups };
    context = `Starting from ${routine.name}.`;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <PageHeader
        title={title}
        description={context ?? `Weights are in ${unit}. Empty set rows are ignored.`}
        actions={
          <Link href="/lifts" className={buttonClass("ghost")}>
            Cancel
          </Link>
        }
      />
      <LiftForm
        initial={initial}
        exercises={exercises}
        restPrefs={restPrefs}
        suggestedIds={suggestedIds}
        unit={unit}
        submitLabel={submitLabel}
      />
    </div>
  );
}
