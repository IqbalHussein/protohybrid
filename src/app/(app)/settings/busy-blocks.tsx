import { requireUser } from "@/lib/auth";
import { getTimeZone } from "@/lib/settings";
import { addDays, formatDateLabel, formatTime, todayIn, zonedParts, zonedToUtc } from "@/lib/time";
import type { BusyBlock } from "@/lib/types";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { BusyBlockForm } from "./busy-blocks-form";
import { deleteBusyBlock } from "./busy-blocks-actions";

function describeBlock(block: BusyBlock, tz: string) {
  const s = zonedParts(block.start_time, tz);
  const e = zonedParts(block.end_time, tz);
  const date = formatDateLabel(s.date);
  const end = e.date === s.date ? formatTime(e.minutes) : `${formatDateLabel(e.date)} ${formatTime(e.minutes)}`;
  return { date, range: `${formatTime(s.minutes)}–${end}` };
}

// Upcoming busy time (manual and synced) for the next four weeks, plus a form
// to add manual blocks such as classes or shifts.
export async function BusyBlocksSection() {
  const { supabase } = await requireUser();
  const tz = await getTimeZone();
  const today = todayIn(tz);
  const until = zonedToUtc(addDays(today, 28), "00:00", tz).toISOString();

  const { data, error } = await supabase
    .from("busy_blocks")
    .select("*")
    .gte("end_time", new Date().toISOString())
    .lt("start_time", until)
    .order("start_time")
    .limit(200)
    .returns<BusyBlock[]>();
  const blocks = data ?? [];

  return (
    <Panel className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">Busy time</h3>
        <p className="max-w-prose text-sm text-chalk-muted">
          Classes, shifts and anything else you plan training around. Sessions that overlap busy time get a warning.
        </p>
      </div>

      <BusyBlockForm today={today} />

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold text-chalk-muted">Next four weeks</h4>
        {error && (
          <p role="alert" className="text-sm text-danger">
            Busy time couldn&apos;t be loaded: {error.message}
          </p>
        )}
        {!error && blocks.length === 0 && <EmptyState>No busy time in the next four weeks.</EmptyState>}
        <ul className="flex flex-col divide-y divide-ink-line">
          {blocks.map((block) => {
            const { date, range } = describeBlock(block, tz);
            return (
              <li key={block.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium">{block.title}</span>
                  <span className="tabular-nums text-chalk-muted">
                    {date}, {range}
                  </span>
                </div>
                {block.source === "manual" ? (
                  <form action={deleteBusyBlock}>
                    <input type="hidden" name="id" value={block.id} />
                    <Button type="submit" variant="danger" size="sm" aria-label={`Delete ${block.title}`}>
                      Delete
                    </Button>
                  </form>
                ) : (
                  <Badge>From Google Calendar</Badge>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}
