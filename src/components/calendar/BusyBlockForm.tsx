import { minutesIntoDay, minutesToTimeString, zonedDateString } from "@/lib/time";
import type { BusyBlock } from "@/lib/calendar/types";

/**
 * The busy-block editor (spec Screens #3): a non-training commitment the week
 * has to fit around — a class, a shift.
 *
 * Collected as a date and two local times, because that is how people describe
 * a shift. `busy_blocks` stores timestamptz; `createBusyBlock` does the one
 * conversion, through the app's single time zone.
 */
export default function BusyBlockForm({
  action,
  date,
  week,
  block,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  date: string;
  week: string;
  block?: BusyBlock | null;
  submitLabel: string;
}) {
  const start = block ? new Date(block.startTime) : null;
  const end = block ? new Date(block.endTime) : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      {block ? <input type="hidden" name="blockId" value={block.id} /> : null}
      <input type="hidden" name="week" value={week} />

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs uppercase tracking-wide text-neutral-400">Title</span>
        <input
          name="title"
          required
          defaultValue={block?.title ?? ""}
          placeholder="Lecture, shift, appointment…"
          className="rounded border border-neutral-300 px-3 py-2 text-base"
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="flex w-44 flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-neutral-400">Day</span>
          <input
            type="date"
            name="date"
            required
            defaultValue={start ? zonedDateString(start) : date}
            className="rounded border border-neutral-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex w-32 flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-neutral-400">From</span>
          <input
            type="time"
            name="startTime"
            required
            defaultValue={start ? minutesToTimeString(minutesIntoDay(start)) : "09:00"}
            className="rounded border border-neutral-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex w-32 flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-neutral-400">To</span>
          <input
            type="time"
            name="endTime"
            required
            defaultValue={end ? minutesToTimeString(minutesIntoDay(end)) : "17:00"}
            className="rounded border border-neutral-300 px-3 py-2 text-base"
          />
        </label>
      </div>

      <p className="text-xs text-neutral-400">
        An end time earlier than the start runs the block past midnight — an overnight or closing
        shift.
      </p>

      <button className="self-start rounded bg-neutral-900 px-4 py-2.5 text-white">{submitLabel}</button>
    </form>
  );
}
