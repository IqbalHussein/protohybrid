import { requireUser } from "@/lib/auth";
import { getTimeZone } from "@/lib/settings";
import { formatDistance, formatDuration, formatPace, runTypeLabel } from "@/lib/runs";
import { addDays, formatDateLabel, formatTime, parseTime, todayIn } from "@/lib/time";
import type { RunDetails, SessionStatus } from "@/lib/types";
import { cn } from "@/lib/cn";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { sessionToneClasses } from "@/components/ui/session-tone";
import { deleteRun, skipRun } from "./actions";
import { LogRunForm } from "./log-run-form";
import { CompleteRunDialog } from "./complete-run-dialog";

type RunRow = {
  id: string;
  planned_date: string;
  planned_start_time: string | null;
  status: SessionStatus;
  ad_hoc: boolean;
  run_details: Omit<RunDetails, "session_id"> | null;
};

const SELECT = "id, planned_date, planned_start_time, status, ad_hoc, run_details(*)";

// Planned runs overdue by up to this many days still show, so a run done
// yesterday can be completed here.
const OVERDUE_DAYS = 14;

function RunChip({ status, runType }: { status: SessionStatus; runType: string }) {
  return (
    <span className={cn("rounded-control px-2 py-0.5 text-xs font-bold", sessionToneClasses("run", status))}>
      {runTypeLabel(runType)}
    </span>
  );
}

function hasTargets(d: RunRow["run_details"]) {
  return d != null && (d.target_distance_km != null || d.target_duration_sec != null || d.target_pace_sec_per_km != null);
}

function TargetStats({ d }: { d: NonNullable<RunRow["run_details"]> }) {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-2">
      {d.target_distance_km != null && <Stat label="Distance" value={formatDistance(Number(d.target_distance_km))} unit="km" />}
      {d.target_duration_sec != null && <Stat label="Time" value={formatDuration(d.target_duration_sec)} />}
      {d.target_pace_sec_per_km != null && <Stat label="Pace" value={formatPace(d.target_pace_sec_per_km)} unit="/km" />}
    </div>
  );
}

function fmt(value: number | null, f: (n: number) => string) {
  return value == null ? "–" : f(Number(value));
}

// Planned vs actual side by side for runs that started from a plan.
function PlanVsActual({ d }: { d: NonNullable<RunRow["run_details"]> }) {
  const rows = [
    { label: "Planned", distance: d.target_distance_km, time: d.target_duration_sec, pace: d.target_pace_sec_per_km, tone: "text-chalk-muted" },
    { label: "Actual", distance: d.actual_distance_km, time: d.actual_duration_sec, pace: d.actual_pace_sec_per_km, tone: "text-chalk" },
  ];
  return (
    <table className="w-full max-w-md text-sm tabular-nums">
      <thead>
        <tr className="text-left text-xs text-chalk-faint">
          <th scope="col" className="pb-1 font-normal">
            <span className="sr-only">Version</span>
          </th>
          <th scope="col" className="pb-1 font-normal">Distance</th>
          <th scope="col" className="pb-1 font-normal">Time</th>
          <th scope="col" className="pb-1 font-normal">Pace</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className={r.tone}>
            <th scope="row" className="pr-4 text-left text-xs font-normal text-chalk-faint">
              {r.label}
            </th>
            <td className="stretch-semi pr-4 font-bold">
              {fmt(r.distance, formatDistance)}
              {r.distance != null && <span className="ml-0.5 text-xs font-medium text-chalk-muted">km</span>}
            </td>
            <td className="stretch-semi pr-4 font-bold">{fmt(r.time, formatDuration)}</td>
            <td className="stretch-semi font-bold">
              {fmt(r.pace, formatPace)}
              {r.pace != null && <span className="ml-0.5 text-xs font-medium text-chalk-muted">/km</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function RunsPage() {
  const { supabase } = await requireUser();
  const tz = await getTimeZone();
  const today = todayIn(tz);

  const [plannedRes, historyRes] = await Promise.all([
    supabase
      .from("sessions")
      .select(SELECT)
      .eq("type", "run")
      .eq("status", "planned")
      .gte("planned_date", addDays(today, -OVERDUE_DAYS))
      .order("planned_date", { ascending: true })
      .order("planned_start_time", { ascending: true, nullsFirst: false })
      .returns<RunRow[]>(),
    supabase
      .from("sessions")
      .select(SELECT)
      .eq("type", "run")
      .eq("status", "completed")
      .order("planned_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<RunRow[]>(),
  ]);
  const planned = plannedRes.data ?? [];
  const runs = historyRes.data ?? [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <PageHeader title="Runs" description="Log a run you've done, or complete one you planned." />

      <section className="flex flex-col gap-4">
        <SectionTitle>Planned runs</SectionTitle>
        {plannedRes.error && (
          <p role="alert" className="text-sm text-danger">
            Planned runs couldn&apos;t be loaded: {plannedRes.error.message}
          </p>
        )}
        {!plannedRes.error && planned.length === 0 && (
          <EmptyState>No planned runs. Plan runs from the week view and they&apos;ll show up here.</EmptyState>
        )}
        <ul className="flex flex-col divide-y divide-ink-line">
          {planned.map((run) => {
            const d = run.run_details;
            const overdue = run.planned_date < today;
            const start = parseTime(run.planned_start_time);
            return (
              <li key={run.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="stretch-semi font-bold">{formatDateLabel(run.planned_date)}</span>
                    {start !== null && <span className="text-sm tabular-nums text-chalk-muted">{formatTime(start)}</span>}
                    <RunChip status={run.status} runType={d?.run_type ?? "run"} />
                    {overdue && <span className="text-xs text-chalk-faint">Past date, not logged yet</span>}
                  </div>
                  {d && hasTargets(d) ? <TargetStats d={d} /> : <p className="text-sm text-chalk-faint">No targets set.</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <CompleteRunDialog
                    trigger="Complete"
                    title={`Complete ${runTypeLabel(d?.run_type ?? "run").toLowerCase()} run`}
                    sessionId={run.id}
                    defaults={{ distanceKm: d?.target_distance_km ?? null, durationSec: d?.target_duration_sec ?? null }}
                  />
                  <form action={skipRun}>
                    <input type="hidden" name="session_id" value={run.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Skip
                    </Button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle>Log a run</SectionTitle>
        <Panel>
          <LogRunForm />
        </Panel>
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle>History</SectionTitle>
        {historyRes.error && (
          <p role="alert" className="text-sm text-danger">
            Runs couldn&apos;t be loaded: {historyRes.error.message}
          </p>
        )}
        {!historyRes.error && runs.length === 0 && <EmptyState>No runs yet. Your logged runs will appear here.</EmptyState>}
        <ul className="flex flex-col divide-y divide-ink-line">
          {runs.map((run) => {
            const d = run.run_details;
            const showPlan = !run.ad_hoc && hasTargets(d);
            return (
              <li key={run.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="stretch-semi font-bold">{formatDateLabel(run.planned_date)}</span>
                    <RunChip status={run.status} runType={d?.run_type ?? "run"} />
                  </div>
                  {d && showPlan ? (
                    <PlanVsActual d={d} />
                  ) : (
                    <div className="flex flex-wrap gap-x-8 gap-y-2">
                      {d?.actual_distance_km != null && (
                        <Stat label="Distance" value={formatDistance(Number(d.actual_distance_km))} unit="km" />
                      )}
                      {d?.actual_duration_sec != null && <Stat label="Time" value={formatDuration(d.actual_duration_sec)} />}
                      {d?.actual_pace_sec_per_km != null && (
                        <Stat label="Pace" value={formatPace(d.actual_pace_sec_per_km)} unit="/km" />
                      )}
                    </div>
                  )}
                  {(d?.actual_avg_hr != null || d?.actual_elevation_m != null) && (
                    <div className="flex flex-wrap gap-x-8 gap-y-2">
                      {d?.actual_avg_hr != null && <Stat label="Avg HR" value={Math.round(Number(d.actual_avg_hr))} unit="bpm" />}
                      {d?.actual_elevation_m != null && (
                        <Stat label="Elevation" value={Math.round(Number(d.actual_elevation_m))} unit="m" />
                      )}
                    </div>
                  )}
                  {d?.notes && <p className="max-w-prose whitespace-pre-line text-sm text-chalk-muted">{d.notes}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {d && (
                    <CompleteRunDialog
                      trigger="Edit"
                      title="Edit run"
                      triggerVariant="ghost"
                      sessionId={run.id}
                      defaults={{
                        distanceKm: d.actual_distance_km != null ? Number(d.actual_distance_km) : null,
                        durationSec: d.actual_duration_sec,
                        avgHr: d.actual_avg_hr != null ? Math.round(Number(d.actual_avg_hr)) : null,
                        elevationM: d.actual_elevation_m != null ? Number(d.actual_elevation_m) : null,
                        notes: d.notes,
                      }}
                    />
                  )}
                  <form action={deleteRun}>
                    <input type="hidden" name="session_id" value={run.id} />
                    <Button type="submit" variant="danger" size="sm">
                      Delete
                    </Button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
