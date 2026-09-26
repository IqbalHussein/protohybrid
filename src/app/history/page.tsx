import Link from "next/link";
import { requireUser, getSetsForSessions } from "@/lib/lift/queries";
import { normalizeSession, SESSION_SELECT, sessionLabel } from "@/lib/calendar";
import { countsAsWork, formatDuration, setVolume } from "@/lib/lift/math";
import { formatDate } from "@/lib/dates";
import { runActualSummary } from "@/lib/summaries";

const PAGE_SIZE = 20;

// Reverse-chronological log of completed sessions, runs and lifts together,
// each expandable to what was actually done.
export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ page?: string; type?: string }> }) {
  const params = await searchParams;
  const page = Math.max(0, Number(params.page) || 0);
  const type = params.type === "run" || params.type === "lift" ? params.type : null;
  const { supabase } = await requireUser();

  let q = supabase
    .from("sessions")
    .select(SESSION_SELECT)
    .eq("status", "completed");
  if (type) q = q.eq("type", type);
  const { data } = await q
    .order("planned_date", { ascending: false })
    .order("planned_time", { ascending: false, nullsFirst: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const rows = (data ?? []).map(normalizeSession);
  const hasMore = rows.length > PAGE_SIZE;
  const sessions = rows.slice(0, PAGE_SIZE);
  const sets = await getSetsForSessions(sessions.filter((s) => s.type === "lift").map((s) => s.id));
  const qs = (p: number) => `/history?page=${p}${type ? `&type=${type}` : ""}`;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">History</h1>
        <div className="flex gap-3 text-sm">
          {[
            [null, "All"],
            ["lift", "Lifts"],
            ["run", "Runs"],
          ].map(([t, label]) => (
            <Link key={label} href={t ? `/history?type=${t}` : "/history"} className={type === t ? "font-medium underline" : "text-neutral-500"}>
              {label}
            </Link>
          ))}
        </div>
      </header>

      {sessions.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing completed yet. Finished workouts and synced runs show up here.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((s) => {
            const exercises = sets.get(s.id) ?? [];
            const volume = exercises
              .flatMap((e) => e.sets)
              .filter((x) => countsAsWork(x.set_type))
              .reduce((sum, x) => sum + setVolume(x.weight, x.reps), 0);
            return (
              <li key={s.id}>
                <details className="rounded border border-neutral-200 px-4 py-3">
                  <summary className="flex cursor-pointer items-baseline justify-between gap-3">
                    <span className="font-medium">{sessionLabel(s)}</span>
                    <span className="text-sm text-neutral-500">
                      {formatDate(s.planned_date, { year: "numeric" })}
                      {s.type === "lift" ? ` · ${formatDuration(s.lift_details?.started_at ?? null, s.lift_details?.completed_at ?? null)}` : ""}
                    </span>
                  </summary>
                  <div className="mt-2 flex flex-col gap-1.5 text-sm">
                    {s.type === "run" ? (
                      <p className="text-neutral-700">{runActualSummary(s) ?? "No stats recorded."}</p>
                    ) : (
                      <>
                        {exercises.map(({ exercise, sets: xs }) => (
                          <p key={exercise.id}>
                            <Link href={`/exercises/${exercise.id}`} className="font-medium hover:underline">
                              {exercise.name}
                            </Link>{" "}
                            <span className="text-neutral-600">
                              {xs.map((x) => `${x.weight ?? "—"}×${x.reps ?? "—"}${x.set_type === "warmup" ? " (w)" : ""}`).join(", ")}
                            </span>
                          </p>
                        ))}
                        <p className="text-neutral-500">{volume.toLocaleString()} lb total volume</p>
                      </>
                    )}
                    <Link href={s.type === "lift" ? `/workout/${s.id}/summary` : `/sessions/${s.id}`} className="self-start text-neutral-500 underline">
                      {s.type === "lift" ? "Summary / edit" : "Details"}
                    </Link>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex justify-between text-sm">
        {page > 0 ? <Link href={qs(page - 1)} className="underline">← Newer</Link> : <span />}
        {hasMore ? <Link href={qs(page + 1)} className="underline">Older →</Link> : null}
      </div>
    </main>
  );
}
