import { RUN_TYPES } from "@/lib/conflicts";
import type { SessionRow } from "@/lib/calendar";
import { toClock } from "@/lib/format";

const input = "rounded border border-neutral-300 px-3 py-2 text-base";
const label = "flex flex-col gap-1 text-sm";

// Planned-session fields shared by the create and edit forms.
export function SessionFields({
  type,
  session,
  date,
  routines,
}: {
  type: "run" | "lift";
  session?: SessionRow;
  date: string;
  routines: { id: string; name: string }[];
}) {
  const run = session?.run_details;
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          Date
          <input name="date" type="date" required defaultValue={date} className={input} />
        </label>
        <label className={label}>
          Time (optional)
          <input name="time" type="time" defaultValue={session?.planned_time?.slice(0, 5) ?? ""} className={input} />
        </label>
      </div>

      {type === "run" ? (
        <>
          <label className={label}>
            Run type
            <select name="runType" defaultValue={run?.run_type ?? "easy"} className={input}>
              {RUN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className={label}>
              Distance (km)
              <input name="targetDistance" inputMode="decimal" defaultValue={run?.target_distance_km ?? ""} className={input} />
            </label>
            <label className={label}>
              Pace (m:ss/km)
              <input name="targetPace" placeholder="5:30" defaultValue={toClock(run?.target_pace_sec_per_km)} className={input} />
            </label>
            <label className={label}>
              Duration
              <input name="targetDuration" placeholder="45:00" defaultValue={toClock(run?.target_duration_sec)} className={input} />
            </label>
          </div>
        </>
      ) : (
        <>
          <label className={label}>
            Focus
            <input
              name="focus"
              placeholder="push / pull / legs / full-body"
              defaultValue={session?.lift_details?.focus ?? ""}
              className={input}
            />
          </label>
          <label className={label}>
            Routine (optional)
            <select name="routineId" defaultValue={session?.routine_id ?? ""} className={input}>
              <option value="">No routine — start blank</option>
              {routines.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <label className={label}>
        Notes
        <textarea name="notes" rows={2} defaultValue={session?.notes ?? ""} className={input} />
      </label>
    </>
  );
}
