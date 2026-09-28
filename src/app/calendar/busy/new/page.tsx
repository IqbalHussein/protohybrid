import Link from "next/link";
import BusyBlockForm from "@/components/calendar/BusyBlockForm";
import { todayInZone } from "@/lib/time";
import { mondayOf } from "@/lib/week";
import { createBusyBlock } from "../../actions";

export default async function NewBusyBlockPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; week?: string }>;
}) {
  const { date, week } = await searchParams;

  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayInZone();
  const weekStart = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? mondayOf(week) : mondayOf(day);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold">Add a commitment</h1>
        <Link href={`/calendar?week=${weekStart}`} className="text-sm text-neutral-500 underline">
          Week
        </Link>
      </header>

      <p className="-mt-2 text-sm text-neutral-500">
        Classes, shifts and anything else training has to fit around. Google Calendar sync will
        later add these automatically; entering them by hand means the grid is useful before any of
        that is wired up.
      </p>

      <BusyBlockForm action={createBusyBlock} date={day} week={weekStart} submitLabel="Add" />
    </main>
  );
}
