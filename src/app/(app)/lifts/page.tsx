import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getWeightUnit } from "@/lib/settings";
import { formatDateLabel } from "@/lib/time";
import { displayWeight } from "@/lib/units";
import { focusLabel, sessionVolume } from "@/lib/lifts";
import type { SessionStatus, SetType } from "@/lib/types";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/stat";
import { sessionToneClasses } from "@/components/ui/session-tone";
import { cn } from "@/lib/cn";

type LiftSessionRow = {
  id: string;
  planned_date: string;
  status: SessionStatus;
  lift_details: { focus: string; notes: string | null } | null;
  routines: { name: string } | null;
};

export default async function LiftsPage() {
  const { supabase, user } = await requireUser();
  const unit = await getWeightUnit(supabase, user.id);

  const [completedRes, plannedRes] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, planned_date, status, lift_details(focus, notes), routines(name)")
      .eq("type", "lift")
      .eq("status", "completed")
      .order("planned_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(30)
      .returns<LiftSessionRow[]>(),
    supabase
      .from("sessions")
      .select("id, planned_date, status, lift_details(focus, notes), routines(name)")
      .eq("type", "lift")
      .eq("status", "planned")
      .order("planned_date")
      .limit(20)
      .returns<LiftSessionRow[]>(),
  ]);

  const completed = completedRes.data ?? [];
  const planned = plannedRes.data ?? [];
  const ids = completed.map((s) => s.id);

  const [setsRes, prsRes] = ids.length
    ? await Promise.all([
        supabase
          .from("lift_sets")
          .select("lift_details_id, exercise_id, set_type, reps, weight")
          .in("lift_details_id", ids)
          .returns<{ lift_details_id: string; exercise_id: string; set_type: SetType; reps: number | null; weight: number | null }[]>(),
        supabase.from("personal_records").select("session_id").in("session_id", ids).returns<{ session_id: string }[]>(),
      ])
    : [{ data: [] }, { data: [] }];

  const setsBySession = new Map<string, { exercise_id: string; set_type: SetType; reps: number | null; weight: number | null }[]>();
  for (const s of setsRes.data ?? []) {
    const list = setsBySession.get(s.lift_details_id) ?? [];
    list.push({ ...s, weight: s.weight === null ? null : Number(s.weight) });
    setsBySession.set(s.lift_details_id, list);
  }
  const prCount = new Map<string, number>();
  for (const pr of prsRes.data ?? []) prCount.set(pr.session_id, (prCount.get(pr.session_id) ?? 0) + 1);

  const loadError = completedRes.error ?? plannedRes.error;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10">
      <PageHeader
        title="Lifts"
        description="Every set you log builds your exercise history and personal records."
        actions={
          <>
            <Link href="/lifts/exercises" className={buttonClass("ghost")}>
              Exercises
            </Link>
            <Link href="/lifts/routines" className={buttonClass("ghost")}>
              Routines
            </Link>
            <Link href="/lifts/log" className={buttonClass("lift")}>
              Log a lift
            </Link>
          </>
        }
      />

      {loadError && (
        <p role="alert" className="text-sm text-danger">
          Lifts couldn&apos;t be loaded: {loadError.message}
        </p>
      )}

      {planned.length > 0 && (
        <section className="flex flex-col gap-4">
          <SectionTitle>Planned</SectionTitle>
          <ul className="flex flex-col gap-2">
            {planned.map((s) => (
              <li
                key={s.id}
                className={cn("flex flex-wrap items-center justify-between gap-3 rounded-panel px-4 py-3", sessionToneClasses("lift", "planned"))}
              >
                <div className="flex flex-col">
                  <span className="stretch-semi font-bold">{formatDateLabel(s.planned_date)}</span>
                  <span className="text-sm text-chalk-muted">
                    {focusLabel(s.lift_details?.focus ?? "lift")}
                    {s.routines?.name ? `, ${s.routines.name}` : ""}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Link href={`/lifts/${s.id}`} className={buttonClass("ghost", "sm")}>
                    Details
                  </Link>
                  <Link href={`/lifts/log?session=${s.id}`} className={buttonClass("lift", "sm")}>
                    Log it
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <SectionTitle>History</SectionTitle>
        {!loadError && completed.length === 0 && (
          <EmptyState
            action={
              <Link href="/lifts/log" className={buttonClass("lift", "sm")}>
                Log a lift
              </Link>
            }
          >
            No lifts logged yet. Log your first session to start tracking personal records.
          </EmptyState>
        )}
        <ul className="flex flex-col divide-y divide-ink-line">
          {completed.map((s) => {
            const sets = setsBySession.get(s.id) ?? [];
            const exerciseCount = new Set(sets.map((x) => x.exercise_id)).size;
            const volume = displayWeight(sessionVolume(sets), unit);
            const prs = prCount.get(s.id) ?? 0;
            return (
              <li key={s.id}>
                <Link
                  href={`/lifts/${s.id}`}
                  className="flex flex-col gap-3 rounded-control py-4 hover:bg-ink-raised/60 sm:flex-row sm:items-center sm:justify-between sm:px-2"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-baseline gap-3">
                      <span className="stretch-semi font-bold">{formatDateLabel(s.planned_date)}</span>
                      <span className="text-sm font-semibold text-lift">{focusLabel(s.lift_details?.focus ?? "lift")}</span>
                      {prs > 0 && <Badge tone="pr">{prs === 1 ? "1 PR" : `${prs} PRs`}</Badge>}
                    </div>
                    {s.routines?.name && <span className="text-xs text-chalk-faint">{s.routines.name}</span>}
                  </div>
                  <div className="flex gap-8">
                    <Stat label="Exercises" value={exerciseCount} />
                    <Stat label="Sets" value={sets.length} />
                    <Stat label="Volume" value={volume ?? 0} unit={unit} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
