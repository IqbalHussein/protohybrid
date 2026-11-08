import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getWeightUnit } from "@/lib/settings";
import { formatDateLabel, formatTime, parseTime } from "@/lib/time";
import { displayWeight, formatWeight } from "@/lib/units";
import { PR_LABELS, SET_TYPE_LABELS, focusLabel, groupByExercise, isUuid, sessionVolume } from "@/lib/lifts";
import type { LiftSet, PersonalRecord, SessionStatus } from "@/lib/types";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { deleteLift, setLiftStatus } from "../actions";
import { ConfirmSubmit } from "../confirm-submit";

type SessionRow = {
  id: string;
  type: string;
  status: SessionStatus;
  planned_date: string;
  planned_start_time: string | null;
  planned_duration_min: number | null;
  ad_hoc: boolean;
  lift_details: { focus: string; notes: string | null } | null;
  routines: { id: string; name: string } | null;
};

type SetRow = Pick<LiftSet, "id" | "exercise_id" | "set_number" | "set_type" | "reps" | "weight" | "rpe" | "created_at">;

export default async function LiftDetailPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  if (!isUuid(sessionId)) notFound();

  const { supabase, user } = await requireUser();
  const { data: session } = await supabase
    .from("sessions")
    .select("id, type, status, planned_date, planned_start_time, planned_duration_min, ad_hoc, lift_details(focus, notes), routines(id, name)")
    .eq("id", sessionId)
    .maybeSingle<SessionRow>();
  if (!session || session.type !== "lift") notFound();

  const [unit, setsRes, prsRes] = await Promise.all([
    getWeightUnit(supabase, user.id),
    supabase
      .from("lift_sets")
      .select("id, exercise_id, set_number, set_type, reps, weight, rpe, created_at")
      .eq("lift_details_id", sessionId)
      .order("created_at")
      .order("set_number")
      .returns<SetRow[]>(),
    supabase
      .from("personal_records")
      .select("exercise_id, record_type, value, weight, reps")
      .eq("session_id", sessionId)
      .returns<Pick<PersonalRecord, "exercise_id" | "record_type" | "value" | "weight" | "reps">[]>(),
  ]);

  const sets = (setsRes.data ?? []).map((s) => ({ ...s, weight: s.weight === null ? null : Number(s.weight) }));
  const groups = groupByExercise(sets);
  const prs = prsRes.data ?? [];

  const exerciseIds = groups.map((g) => g.exercise_id);
  const { data: exerciseRows } = exerciseIds.length
    ? await supabase.from("exercises").select("id, name").in("id", exerciseIds)
    : { data: [] as { id: string; name: string }[] };
  const names = new Map((exerciseRows ?? []).map((e) => [e.id as string, e.name as string]));

  const focus = focusLabel(session.lift_details?.focus ?? "lift");
  const start = parseTime(session.planned_start_time);
  const isPlanned = session.status === "planned";
  const isSkipped = session.status === "skipped";

  const prText = (pr: (typeof prs)[number]) => {
    if (pr.record_type === "most_reps") return `${Number(pr.value)} reps${pr.weight ? ` at ${formatWeight(Number(pr.weight), unit)}` : ""}`;
    if (pr.record_type === "heaviest_weight") return `${formatWeight(Number(pr.value), unit)}${pr.reps ? ` for ${pr.reps}` : ""}`;
    return formatWeight(Number(pr.value), unit);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <PageHeader
        title={`${focus} lift`}
        description={
          <>
            {formatDateLabel(session.planned_date)}
            {start !== null ? ` at ${formatTime(start)}` : ""}
            {session.routines ? `, from ${session.routines.name}` : ""}
            {isSkipped ? ". Skipped." : isPlanned ? ". Planned." : ""}
          </>
        }
        actions={
          <>
            <Link href="/lifts" className={buttonClass("ghost")}>
              All lifts
            </Link>
            {isPlanned ? (
              <Link href={`/lifts/log?session=${session.id}`} className={buttonClass("lift")}>
                Log it
              </Link>
            ) : session.status === "completed" ? (
              <Link href={`/lifts/log?edit=${session.id}`} className={buttonClass("secondary")}>
                Edit
              </Link>
            ) : null}
          </>
        }
      />

      {session.lift_details?.notes && (
        <p className="max-w-prose whitespace-pre-line text-sm text-chalk-muted">{session.lift_details.notes}</p>
      )}

      {session.status === "completed" && (
        <div className="flex flex-wrap gap-8">
          <Stat label="Exercises" value={groups.length} />
          <Stat label="Sets" value={sets.length} />
          <Stat label="Volume" value={displayWeight(sessionVolume(sets), unit) ?? 0} unit={unit} />
          <Stat label="Records" value={prs.length} />
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState>
          {isPlanned ? "No sets yet. Log this lift when you've done it." : "This lift has no sets."}
        </EmptyState>
      ) : (
        <section className="flex flex-col gap-4">
          <SectionTitle>Sets</SectionTitle>
          {groups.map((g) => {
            const exercisePrs = prs.filter((p) => p.exercise_id === g.exercise_id);
            return (
              <Panel key={g.exercise_id} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/lifts/exercises/${g.exercise_id}`} className="stretch-semi font-bold hover:text-lift-strong">
                    {names.get(g.exercise_id) ?? "Exercise"}
                  </Link>
                  <div className="flex flex-wrap gap-1.5">
                    {exercisePrs.map((p) => (
                      <Badge key={p.record_type} tone="pr">
                        {PR_LABELS[p.record_type]} {prText(p)}
                      </Badge>
                    ))}
                  </div>
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-chalk-faint">
                    <tr>
                      <th scope="col" className="py-1 pr-3 font-medium">Set</th>
                      <th scope="col" className="py-1 pr-3 font-medium">Type</th>
                      <th scope="col" className="py-1 pr-3 font-medium">Reps</th>
                      <th scope="col" className="py-1 pr-3 font-medium">Weight</th>
                      <th scope="col" className="py-1 font-medium">RPE</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {g.sets.map((s, i) => (
                      <tr key={s.id} className={s.set_type === "warmup" ? "text-chalk-faint" : undefined}>
                        <td className="py-1 pr-3">{i + 1}</td>
                        <td className="py-1 pr-3">{SET_TYPE_LABELS[s.set_type]}</td>
                        <td className="py-1 pr-3">{s.reps ?? ""}</td>
                        <td className="py-1 pr-3">{formatWeight(s.weight, unit)}</td>
                        <td className="py-1">{s.rpe != null ? Number(s.rpe) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            );
          })}
        </section>
      )}

      <div className="flex flex-wrap gap-3 border-t border-ink-line pt-6">
        {(isPlanned || isSkipped) && (
          <form action={setLiftStatus}>
            <input type="hidden" name="session_id" value={session.id} />
            <input type="hidden" name="status" value={isPlanned ? "skipped" : "planned"} />
            <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
              {isPlanned ? "Skip this lift" : "Restore as planned"}
            </SubmitButton>
          </form>
        )}
        <form action={deleteLift}>
          <input type="hidden" name="session_id" value={session.id} />
          <ConfirmSubmit confirmMessage="Delete this lift and its sets? Personal records will be recalculated." pendingLabel="Deleting…">
            Delete lift
          </ConfirmSubmit>
        </form>
      </div>
    </div>
  );
}
