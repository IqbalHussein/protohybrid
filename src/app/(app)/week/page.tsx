import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getTimeZone } from "@/lib/settings";
import { conflictsByDate, conflictsBySession, conflictsTouching, detectConflicts } from "@/lib/conflicts";
import { addDays, formatDateLabel, formatWeekRange, isValidDate, todayIn, weekDays, weekStart } from "@/lib/time";
import { buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { loadBusy, loadRoutines, loadRules, loadSessions, toConflictSession } from "./data";
import { LoadStrip } from "./load-strip";
import { PlanSessionForm } from "./plan-session-form";
import { WeekBoard } from "./week-board";

export default async function WeekPage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const { start: startParam } = await searchParams;
  const { supabase } = await requireUser();
  const tz = await getTimeZone();
  const today = todayIn(tz);
  const thisWeek = weekStart(today);
  const start = startParam && isValidDate(startParam) ? weekStart(startParam) : thisWeek;
  const dates = weekDays(start);

  // Conflicts can span week boundaries, so evaluate a wider window. Rule
  // limits cap at 30 days (max_days_without_rest) and 168 h, so 31 days either
  // side of the week is enough to see any streak or gap that touches it.
  const [sessionsResult, busyResult, rulesResult, routines] = await Promise.all([
    loadSessions(supabase, addDays(start, -31), addDays(start, 6 + 31)),
    loadBusy(supabase, start, tz),
    loadRules(supabase),
    loadRoutines(supabase),
  ]);

  const allConflicts = detectConflicts(
    sessionsResult.sessions.map(toConflictSession),
    busyResult.pieces,
    rulesResult.rules,
  );
  const weekConflicts = conflictsTouching(allConflicts, dates);
  const bySession = conflictsBySession(weekConflicts);
  const byDate = conflictsByDate(weekConflicts);

  const weekSessions = sessionsResult.sessions
    .filter((s) => s.date >= dates[0] && s.date <= dates[6])
    .map((s) => ({ ...s, conflicts: (bySession.get(s.id) ?? []).map((c) => c.message) }));

  const days = dates.map((date) => ({
    date,
    isToday: date === today,
    busy: busyResult.pieces
      .filter((p) => p.date === date)
      .map((p) => ({ id: p.id, title: p.title, startMin: p.startMin, endMin: p.endMin, source: p.source })),
  }));

  const loadError = sessionsResult.error ?? busyResult.error ?? rulesResult.error;

  return (
    <div className="mx-auto flex max-w-[90rem] flex-col gap-8">
      <PageHeader
        title={formatWeekRange(start)}
        description={start === thisWeek ? "This week" : undefined}
        actions={
          <>
            <nav aria-label="Weeks" className="flex items-center gap-2">
              <Link href={`/week?start=${addDays(start, -7)}`} className={buttonClass("secondary", "sm")}>
                Previous week
              </Link>
              {start !== thisWeek && (
                <Link href="/week" className={buttonClass("secondary", "sm")}>
                  This week
                </Link>
              )}
              <Link href={`/week?start=${addDays(start, 7)}`} className={buttonClass("secondary", "sm")}>
                Next week
              </Link>
            </nav>
            <Dialog trigger="Plan a session" triggerVariant="primary" triggerSize="sm" title="Plan a session">
              <PlanSessionForm date={start === thisWeek ? today : start} routines={routines} />
            </Dialog>
          </>
        }
      />

      {loadError && (
        <p role="alert" className="text-sm text-danger">
          Some of this week couldn&apos;t be loaded: {loadError}
        </p>
      )}

      <LoadStrip days={days} sessions={weekSessions} conflictsByDate={byDate} />

      <WeekBoard days={days} sessions={weekSessions} routines={routines} />

      <section className="flex flex-col gap-4">
        <SectionTitle
          actions={
            <Link href="/settings" className={buttonClass("ghost", "sm")}>
              Edit rules
            </Link>
          }
        >
          Conflicts
        </SectionTitle>
        {weekConflicts.length === 0 ? (
          <p className="text-sm text-chalk-muted">No conflicts this week.</p>
        ) : (
          <Panel className="p-0 sm:p-0">
            <ul className="divide-y divide-ink-line">
              {weekConflicts.map((c, i) => (
                <li key={`${c.ruleId}-${c.sessionIds.join("-")}-${i}`} className="flex flex-col gap-1 px-4 py-3 sm:px-5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-chalk px-1.5 text-xs font-extrabold text-ink">!</span>
                    <span className="text-sm font-semibold">{c.ruleName}</span>
                    <span className="text-xs text-chalk-faint">{c.dates.map(formatDateLabel).join(", ")}</span>
                  </span>
                  <span className="text-sm text-chalk-muted">{c.message}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </section>
    </div>
  );
}
