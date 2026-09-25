import Link from "next/link";
import { getRoutines } from "@/lib/lift/queries";
import { getSettings } from "@/lib/settings";
import { isDateString, todayIn } from "@/lib/dates";
import { SessionFields } from "@/components/SessionFields";
import { createSession } from "../actions";

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; type?: string }>;
}) {
  const params = await searchParams;
  const { timezone } = await getSettings();
  const date = params.date && isDateString(params.date) ? params.date : todayIn(timezone);
  const type = params.type === "lift" ? "lift" : "run";
  const routines = type === "lift" ? await getRoutines() : [];

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-8">
      <h1 className="text-xl font-semibold">Plan a session</h1>

      <div className="flex gap-2">
        {(["run", "lift"] as const).map((t) => (
          <Link
            key={t}
            href={`/sessions/new?date=${date}&type=${t}`}
            className={`flex-1 rounded border px-4 py-2 text-center capitalize ${
              t === type ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"
            }`}
          >
            {t}
          </Link>
        ))}
      </div>

      <form action={createSession} className="flex flex-col gap-3">
        <input type="hidden" name="type" value={type} />
        <SessionFields type={type} date={date} routines={routines} />
        <button className="rounded bg-neutral-900 px-4 py-3 text-white">Add to calendar</button>
      </form>
    </main>
  );
}
