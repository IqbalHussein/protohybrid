import Link from "next/link";
import { notFound } from "next/navigation";
import ConfirmButton from "@/components/ConfirmButton";
import BusyBlockForm from "@/components/calendar/BusyBlockForm";
import { getBusyBlock } from "@/lib/calendar/queries";
import { formatTimeOfDay, minutesIntoDay, zonedDateString } from "@/lib/time";
import { mondayOf } from "@/lib/week";
import { deleteBusyBlock, updateBusyBlock } from "../../actions";

export default async function BusyBlockPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { id } = await params;
  const { week } = await searchParams;

  const block = await getBusyBlock(id);
  if (!block) notFound();

  const start = new Date(block.startTime);
  const end = new Date(block.endTime);
  const date = zonedDateString(start);
  const weekStart = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? mondayOf(week) : mondayOf(date);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{block.title}</h1>
          <p className="text-sm tabular-nums text-neutral-500">
            {date} · {formatTimeOfDay(minutesIntoDay(start))} – {formatTimeOfDay(minutesIntoDay(end))}
          </p>
        </div>
        <Link href={`/calendar?week=${weekStart}`} className="text-sm text-neutral-500 underline">
          Week
        </Link>
      </header>

      {block.source === "manual" ? (
        <>
          <BusyBlockForm
            action={updateBusyBlock}
            date={date}
            week={weekStart}
            block={block}
            submitLabel="Save"
          />

          <form action={deleteBusyBlock} className="self-start border-t border-neutral-100 pt-5">
            <input type="hidden" name="blockId" value={id} />
            <input type="hidden" name="week" value={weekStart} />
            <ConfirmButton
              message="Delete this commitment?"
              className="text-xs text-neutral-400 underline hover:text-red-600"
            >
              Delete commitment
            </ConfirmButton>
          </form>
        </>
      ) : (
        /* Synced blocks mirror something else; editing them here would be
           overwritten on the next sync. */
        <p className="rounded border border-neutral-200 px-4 py-3 text-sm text-neutral-600">
          This commitment came from Google Calendar. Edit it there and it will re-sync.
        </p>
      )}
    </main>
  );
}
