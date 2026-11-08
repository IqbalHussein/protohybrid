import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getWeightUnit } from "@/lib/settings";
import { formatDateLabel } from "@/lib/time";
import { formatWeight } from "@/lib/units";
import { PR_LABELS, SET_TYPE_LABELS, e1rm, isUuid } from "@/lib/lifts";
import type { PrRecordType, SetType } from "@/lib/types";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/stat";
import { buttonClass } from "@/components/ui/button";
import { fetchAll } from "../../data";
import { chunk } from "../chunk";

type SetRow = {
  id: string;
  lift_details_id: string;
  set_number: number;
  set_type: SetType;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
  created_at: string;
};
type PrRow = { id: string; record_type: PrRecordType; value: number; weight: number | null; reps: number | null; session_id: string | null };

const RECORD_ORDER: PrRecordType[] = ["heaviest_weight", "best_e1rm", "most_reps", "best_volume"];

export default async function ExerciseDetailPage({ params }: { params: Promise<{ exerciseId: string }> }) {
  const { exerciseId } = await params;
  if (!isUuid(exerciseId)) notFound();

  const { supabase, user } = await requireUser();
  const { data: exercise } = await supabase
    .from("exercises")
    .select("id, name, muscle_group, equipment, is_custom")
    .eq("id", exerciseId)
    .maybeSingle();
  if (!exercise) notFound();

  const [unit, sets, prs] = await Promise.all([
    getWeightUnit(supabase, user.id),
    fetchAll<SetRow>((from, to) =>
      supabase
        .from("lift_sets")
        .select("id, lift_details_id, set_number, set_type, reps, weight, rpe, created_at")
        .eq("exercise_id", exerciseId)
        .order("id")
        .range(from, to),
    ),
    fetchAll<PrRow>((from, to) =>
      supabase
        .from("personal_records")
        .select("id, record_type, value, weight, reps, session_id")
        .eq("exercise_id", exerciseId)
        .order("id")
        .range(from, to),
    ),
  ]);

  const sessionIds = [...new Set(sets.map((s) => s.lift_details_id))];
  const dates = new Map<string, string>();
  const parts = await Promise.all(
    chunk(sessionIds, 150).map((part) =>
      supabase.from("sessions").select("id, planned_date").eq("status", "completed").in("id", part),
    ),
  );
  for (const { data } of parts) for (const s of data ?? []) dates.set(s.id, s.planned_date);

  const setsBySession = new Map<string, typeof sets>();
  for (const s of sets) {
    const list = setsBySession.get(s.lift_details_id);
    if (list) list.push(s);
    else setsBySession.set(s.lift_details_id, [s]);
  }

  const history = [...dates.entries()]
    .map(([id, date]) => ({
      id,
      date,
      sets: (setsBySession.get(id) ?? [])
        .map((s) => ({ ...s, weight: s.weight === null ? null : Number(s.weight) }))
        .sort((a, b) => a.set_number - b.set_number),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const prTimeline = RECORD_ORDER.map((type) => ({
    type,
    entries: prs
      .filter((p) => p.record_type === type && p.session_id && dates.has(p.session_id))
      .map((p) => ({ ...p, date: dates.get(p.session_id!)! }))
      .sort((a, b) => (a.date < b.date ? 1 : -1)),
  }));

  const prValue = (p: PrRow) => {
    if (p.record_type === "most_reps") return `${Number(p.value)} reps${p.weight ? ` at ${formatWeight(Number(p.weight), unit)}` : ""}`;
    if (p.record_type === "heaviest_weight") return `${formatWeight(Number(p.value), unit)}${p.reps ? ` for ${p.reps}` : ""}`;
    if (p.record_type === "best_e1rm")
      return `${formatWeight(Number(p.value), unit)}${p.weight && p.reps ? ` (${formatWeight(Number(p.weight), unit)} for ${p.reps})` : ""}`;
    return formatWeight(Number(p.value), unit);
  };

  const meta = [exercise.muscle_group, exercise.equipment, exercise.is_custom ? "Custom exercise" : null].filter(Boolean).join(", ");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <PageHeader
        title={exercise.name}
        description={meta || undefined}
        actions={
          <Link href="/lifts/exercises" className={buttonClass("ghost")}>
            All exercises
          </Link>
        }
      />

      <section className="flex flex-col gap-4">
        <SectionTitle>Personal records</SectionTitle>
        {prs.length === 0 ? (
          <EmptyState>Records appear after you log working sets with reps.</EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {prTimeline.map(({ type, entries }) => (
              <Panel key={type} className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-chalk-muted">{PR_LABELS[type]}</h3>
                {entries.length === 0 ? (
                  <p className="text-sm text-chalk-faint">None yet.</p>
                ) : (
                  <>
                    <p className="stretch-wide text-2xl font-extrabold text-lift">{prValue(entries[0])}</p>
                    <ol className="flex flex-col gap-1 text-sm">
                      {entries.map((e) => (
                        <li key={e.id} className="flex justify-between gap-3 text-chalk-muted">
                          <Link href={`/lifts/${e.session_id}`} className="hover:text-chalk">
                            {formatDateLabel(e.date)}
                          </Link>
                          <span className="tabular-nums">{prValue(e)}</span>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </Panel>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle>History</SectionTitle>
        {history.length === 0 ? (
          <EmptyState>You haven&apos;t logged this exercise yet.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-ink-line">
            {history.map((h) => {
              const working = h.sets.filter((s) => s.set_type !== "warmup");
              const top = working.reduce<number | null>((m, s) => (s.weight !== null && (m === null || s.weight > m) ? s.weight : m), null);
              const bestE1rm = working.reduce<number | null>((m, s) => {
                const v = e1rm(s.weight, s.reps);
                return v !== null && (m === null || v > m) ? v : m;
              }, null);
              return (
                <li key={h.id} className="flex flex-col gap-3 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <Link href={`/lifts/${h.id}`} className="stretch-semi font-bold hover:text-lift-strong">
                      {formatDateLabel(h.date)}
                    </Link>
                    <div className="flex gap-6">
                      <Stat label="Top set" value={top !== null ? formatWeight(top, unit) : "–"} />
                      <Stat label="e1RM" value={bestE1rm !== null ? formatWeight(bestE1rm, unit) : "–"} />
                    </div>
                  </div>
                  <ol className="flex flex-wrap gap-2 text-sm tabular-nums">
                    {h.sets.map((s) => (
                      <li
                        key={s.id}
                        className={`rounded-control border px-2 py-1 ${s.set_type === "warmup" ? "border-ink-line text-chalk-faint" : "border-ink-line-strong"}`}
                        title={SET_TYPE_LABELS[s.set_type]}
                      >
                        {s.weight !== null ? formatWeight(s.weight, unit) : "Bodyweight"}
                        {s.reps !== null ? ` for ${s.reps}` : ""}
                        {s.set_type !== "working" && <span className="sr-only">, {SET_TYPE_LABELS[s.set_type]}</span>}
                      </li>
                    ))}
                  </ol>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
