import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { generatePlan, type GeneratedBlock, type Relaxation } from "@/lib/planner";
import { getTimeZone } from "@/lib/settings";
import { addDays, formatDateLabel, formatDayMonth, todayIn } from "@/lib/time";
import { blockStartFor } from "@/lib/training-profile";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { AcceptForm } from "./accept-form";
import { loadActiveBlock, loadProfile, viewFromGenerated } from "./data";
import { PlanView } from "./plan-view";

function Relaxations({ items }: { items: Relaxation[] }) {
  if (items.length === 0) return null;
  return (
    <details className="group rounded-panel border border-ink-line bg-ink-raised px-4">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-chalk-faint transition-transform group-open:rotate-90">›</span>
        {items.length} {items.length === 1 ? "adjustment" : "adjustments"} to fit your constraints
      </summary>
      <ul className="flex flex-col gap-3 pb-4">
        {items.map((r, i) => (
          <li key={`${r.constraint}-${i}`} className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold">{r.title}</span>
            <span className="text-sm text-chalk-muted">{r.detail}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// Drops sessions dated before `from` (a preview that starts this week skips them).
function fromDate(block: GeneratedBlock, from: string): GeneratedBlock {
  return { ...block, weeks: block.weeks.map((w) => ({ ...w, sessions: w.sessions.filter((s) => s.date >= from) })) };
}

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ preview?: string; start?: string }> }) {
  const params = await searchParams;
  const { supabase, user } = await requireUser();
  const today = todayIn(await getTimeZone());
  const [profile, active] = await Promise.all([loadProfile(supabase, user.id), loadActiveBlock(supabase)]);

  if (!profile) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <PageHeader title="Plan" />
        <Panel className="flex flex-col items-start gap-4 sm:p-8">
          <h2 className="stretch-wide text-2xl font-extrabold leading-tight">Build a 4-week plan from your goals in under a minute</h2>
          <p className="max-w-prose text-sm text-chalk-muted">
            Tell us how you want to train and how much time you have. We&apos;ll schedule runs and lifts so they work together,
            then you log against them like any other session.
          </p>
          <Link href="/plan/setup" className={buttonClass("primary", "md", "h-12 px-6")}>
            Get started
          </Link>
        </Panel>
      </div>
    );
  }

  if (active && !params.preview) {
    const { block, sessions, weeks } = active;
    const end = addDays(block.start_date, block.weeks * 7 - 1);
    return (
      <div className="mx-auto flex max-w-[90rem] flex-col gap-6">
        <PageHeader
          title="Your plan"
          description={`${formatDateLabel(block.start_date)} – ${formatDateLabel(end)}${block.summary ? `. ${block.summary}` : ""}`}
          actions={
            <>
              <Link href="/plan/setup" className={buttonClass("secondary", "md", "h-11")}>
                Edit profile
              </Link>
              <Link href="/plan?preview=1" className={buttonClass("secondary", "md", "h-11")}>
                Regenerate
              </Link>
            </>
          }
        />
        <Relaxations items={block.relaxations} />
        <PlanView weeks={weeks} sessions={sessions} today={today} active />
      </div>
    );
  }

  const start = params.start === "this" ? "this" : "next";
  let generated: GeneratedBlock | null = null;
  let failure: string | null = null;
  try {
    generated = generatePlan(profile, { startDate: blockStartFor(today, start) });
  } catch (e) {
    failure = e instanceof Error ? e.message : "unknown error";
  }

  const actions = (
    <>
      <Link href="/plan/setup" className={buttonClass("secondary", "md", "h-11")}>
        Edit profile
      </Link>
      {active && (
        <Link href="/plan" className={buttonClass("ghost", "md", "h-11")}>
          Current plan
        </Link>
      )}
    </>
  );

  if (!generated) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <PageHeader title="Your plan preview" actions={actions} />
        <EmptyState>We couldn&apos;t build a plan from your profile: {failure}. Try changing your days or minutes.</EmptyState>
      </div>
    );
  }

  const shown = start === "this" ? fromDate(generated, today) : generated;
  const view = viewFromGenerated(shown);
  return (
    <div className="mx-auto flex max-w-[90rem] flex-col gap-6">
      <PageHeader
        title="Your plan preview"
        description={`Starts ${formatDateLabel(shown.startDate)}${generated.summary ? `. ${generated.summary}` : ""}`}
        actions={actions}
      />
      <Relaxations items={generated.relaxations} />
      <PlanView key={start} weeks={view.weeks} sessions={view.sessions} today={today} active={false} />
      <div className="mx-auto w-full max-w-3xl">
        <AcceptForm start={start} nextLabel={formatDayMonth(blockStartFor(today, "next"))} hasActive={!!active} />
      </div>
    </div>
  );
}
