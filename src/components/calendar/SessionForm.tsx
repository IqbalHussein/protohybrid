import { RUN_TYPES, RUN_TYPE_LABELS, type CalendarSession } from "@/lib/calendar/types";
import { secondsToMinutes } from "@/lib/calendar/runs";
import { minutesToTimeString } from "@/lib/time";
import type { SessionType } from "@/lib/types";

/**
 * The session editor (spec Screens #2), shared by create and edit.
 *
 * A server component with a plain form: it is also the no-JS reschedule path,
 * so date and time have to be ordinary fields that work without the grid.
 */
export default function SessionForm({
  action,
  type,
  date,
  session,
  routines,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  type: SessionType;
  date: string;
  session?: CalendarSession | null;
  routines: { id: string; name: string }[];
  submitLabel: string;
}) {
  const run = session?.run ?? null;
  const lift = session?.lift ?? null;

  return (
    <form action={action} className="flex flex-col gap-4">
      {session ? <input type="hidden" name="sessionId" value={session.id} /> : null}
      <input type="hidden" name="type" value={type} />

      <div className="flex flex-wrap gap-3">
        <Field label="Day" className="w-44">
          <input
            type="date"
            name="date"
            required
            defaultValue={date}
            className="rounded border border-neutral-300 px-3 py-2 text-base"
          />
        </Field>

        <Field label="Start time" hint="Leave blank for “anytime that day”" className="w-36">
          <input
            type="time"
            name="startTime"
            defaultValue={session?.startMin != null ? minutesToTimeString(session.startMin) : ""}
            className="rounded border border-neutral-300 px-3 py-2 text-base"
          />
        </Field>

        <Field label="Duration" hint="Minutes" className="w-28">
          <input
            name="durationMin"
            inputMode="numeric"
            defaultValue={session?.durationMin ?? ""}
            className="rounded border border-neutral-300 px-3 py-2 text-base"
          />
        </Field>
      </div>

      {type === "run" ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-xs uppercase tracking-wide text-neutral-400">Run</legend>
          <div className="flex flex-wrap gap-3">
            {/* run_details.run_type is NOT NULL, so this choice can't be deferred. */}
            <Field label="Type" className="w-36">
              <select
                name="runType"
                required
                defaultValue={run?.run_type ?? "easy"}
                className="rounded border border-neutral-300 px-3 py-2 text-base"
              >
                {RUN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {RUN_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Distance" hint="km" className="w-28">
              <input
                name="targetDistanceKm"
                inputMode="decimal"
                defaultValue={run?.target_distance_km ?? ""}
                className="rounded border border-neutral-300 px-3 py-2 text-base"
              />
            </Field>
            <Field label="Duration" hint="Minutes" className="w-28">
              <input
                name="targetDurationMin"
                inputMode="numeric"
                defaultValue={secondsToMinutes(run?.target_duration_sec ?? null) ?? ""}
                className="rounded border border-neutral-300 px-3 py-2 text-base"
              />
            </Field>
            <Field label="Pace" hint="m:ss /km — derived if blank" className="w-36">
              <input
                name="targetPace"
                placeholder="5:30"
                defaultValue={paceInput(run?.target_pace_sec_per_km ?? null)}
                className="rounded border border-neutral-300 px-3 py-2 text-base"
              />
            </Field>
          </div>
        </fieldset>
      ) : (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-xs uppercase tracking-wide text-neutral-400">Lift</legend>
          <div className="flex flex-wrap gap-3">
            <Field label="Focus" className="w-56">
              <input
                name="focus"
                required
                defaultValue={lift?.focus ?? ""}
                placeholder="push / pull / legs / full-body"
                className="rounded border border-neutral-300 px-3 py-2 text-base"
              />
            </Field>
            <Field label="Routine" hint="Its exercises pre-fill the logger" className="w-56">
              <select
                name="routineId"
                defaultValue={session?.routineId ?? ""}
                className="rounded border border-neutral-300 px-3 py-2 text-base"
              >
                <option value="">No routine</option>
                {routines.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              name="notes"
              rows={2}
              defaultValue={lift?.notes ?? ""}
              className="rounded border border-neutral-300 px-3 py-2 text-base"
            />
          </Field>
        </fieldset>
      )}

      <button className="self-start rounded bg-neutral-900 px-4 py-2.5 text-white">{submitLabel}</button>
    </form>
  );
}

/** Seconds per km back into the "m:ss" the field accepts. */
function paceInput(secPerKm: number | null): string {
  if (!secPerKm || secPerKm <= 0) return "";
  return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm) % 60).padStart(2, "0")}`;
}

function Field({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`}>
      <span className="text-xs uppercase tracking-wide text-neutral-400">{label}</span>
      {children}
      {hint ? <span className="text-xs text-neutral-400">{hint}</span> : null}
    </label>
  );
}
