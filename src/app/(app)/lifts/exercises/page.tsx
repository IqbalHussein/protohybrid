import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getWeightUnit } from "@/lib/settings";
import { formatDateLabel } from "@/lib/time";
import { formatWeight } from "@/lib/units";
import type { PrRecordType } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/stat";
import { fetchAll } from "../data";
import { chunk } from "./chunk";

type PrRow = { exercise_id: string; record_type: PrRecordType; value: number; reps: number | null };

export default async function ExercisesPage() {
  const { supabase, user } = await requireUser();
  const unit = await getWeightUnit(supabase, user.id);

  const [sets, sessions, prs] = await Promise.all([
    fetchAll<{ exercise_id: string; lift_details_id: string; id: string }>((from, to) =>
      supabase.from("lift_sets").select("id, exercise_id, lift_details_id").order("id").range(from, to),
    ),
    fetchAll<{ id: string; planned_date: string }>((from, to) =>
      supabase
        .from("sessions")
        .select("id, planned_date")
        .eq("type", "lift")
        .eq("status", "completed")
        .order("id")
        .range(from, to),
    ),
    fetchAll<PrRow & { id: string }>((from, to) =>
      supabase.from("personal_records").select("id, exercise_id, record_type, value, reps").order("id").range(from, to),
    ),
  ]);

  const sessionDate = new Map(sessions.map((s) => [s.id, s.planned_date]));
  const lastDone = new Map<string, string>();
  const sessionCount = new Map<string, Set<string>>();
  for (const s of sets) {
    const date = sessionDate.get(s.lift_details_id);
    if (!date) continue; // planned or skipped sessions don't count
    if (!lastDone.has(s.exercise_id) || date > lastDone.get(s.exercise_id)!) lastDone.set(s.exercise_id, date);
    const set = sessionCount.get(s.exercise_id) ?? new Set();
    set.add(s.lift_details_id);
    sessionCount.set(s.exercise_id, set);
  }

  const best = new Map<string, Partial<Record<PrRecordType, PrRow>>>();
  for (const pr of prs) {
    const entry = best.get(pr.exercise_id) ?? {};
    const current = entry[pr.record_type];
    if (!current || Number(pr.value) > Number(current.value)) entry[pr.record_type] = pr;
    best.set(pr.exercise_id, entry);
  }

  const ids = [...lastDone.keys()];
  const names = new Map<string, string>();
  for (const part of chunk(ids, 150)) {
    const { data } = await supabase.from("exercises").select("id, name").in("id", part);
    for (const e of data ?? []) names.set(e.id, e.name);
  }

  const rows = ids
    .map((id) => ({ id, name: names.get(id) ?? "Exercise", last: lastDone.get(id)!, sessions: sessionCount.get(id)?.size ?? 0 }))
    .sort((a, b) => (a.last === b.last ? a.name.localeCompare(b.name) : a.last < b.last ? 1 : -1));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <PageHeader
        title="Exercises"
        description="Your best marks for every exercise you've logged."
        actions={
          <Link href="/lifts" className={buttonClass("ghost")}>
            All lifts
          </Link>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          action={
            <Link href="/lifts/log" className={buttonClass("lift", "sm")}>
              Log a lift
            </Link>
          }
        >
          Exercises appear here once you&apos;ve logged them.
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-ink-line">
          {rows.map((r) => {
            const b = best.get(r.id) ?? {};
            return (
              <li key={r.id}>
                <Link
                  href={`/lifts/exercises/${r.id}`}
                  className="flex flex-col gap-3 rounded-control py-4 hover:bg-ink-raised/60 md:flex-row md:items-center md:justify-between md:px-2"
                >
                  <div className="flex flex-col">
                    <span className="stretch-semi font-bold">{r.name}</span>
                    <span className="text-xs text-chalk-faint">
                      Last done {formatDateLabel(r.last)}, {r.sessions === 1 ? "1 session" : `${r.sessions} sessions`}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-8 gap-y-2">
                    <Stat label="Heaviest" value={b.heaviest_weight ? formatWeight(Number(b.heaviest_weight.value), unit) : "–"} />
                    <Stat label="Best e1RM" value={b.best_e1rm ? formatWeight(Number(b.best_e1rm.value), unit) : "–"} />
                    <Stat label="Most reps" value={b.most_reps ? Number(b.most_reps.value) : "–"} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
