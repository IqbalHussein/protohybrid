import Link from "next/link";
import SessionForm from "@/components/calendar/SessionForm";
import { getRoutineOptions } from "@/lib/calendar/queries";
import { todayInZone } from "@/lib/time";
import { mondayOf } from "@/lib/week";
import { createSession } from "../../actions";

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; type?: string }>;
}) {
  const { date, type } = await searchParams;

  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayInZone();
  const back = `/calendar?week=${mondayOf(day)}`;

  // Type and day are the only things a session needs; everything else is
  // optional, so the one unavoidable question is asked first.
  if (type !== "run" && type !== "lift") {
    return (
      <Shell title="Plan a session" back={back}>
        <p className="text-sm text-neutral-500">What are you planning for {day}?</p>
        <div className="flex gap-3">
          <Link
            href={`/calendar/session/new?date=${day}&type=run`}
            className="flex-1 rounded border border-sky-300 bg-sky-50 px-4 py-3 text-center text-sky-900"
          >
            Run
          </Link>
          <Link
            href={`/calendar/session/new?date=${day}&type=lift`}
            className="flex-1 rounded border border-violet-300 bg-violet-50 px-4 py-3 text-center text-violet-900"
          >
            Lift
          </Link>
        </div>
      </Shell>
    );
  }

  const routines = type === "lift" ? await getRoutineOptions() : [];

  return (
    <Shell title={type === "run" ? "Plan a run" : "Plan a lift"} back={back}>
      <SessionForm
        action={createSession}
        type={type}
        date={day}
        routines={routines}
        submitLabel="Add to the week"
      />
    </Shell>
  );
}

function Shell({
  title,
  back,
  children,
}: {
  title: string;
  back: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold">{title}</h1>
        <Link href={back} className="text-sm text-neutral-500 underline">
          Week
        </Link>
      </header>
      {children}
    </main>
  );
}
