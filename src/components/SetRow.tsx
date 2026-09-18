"use client";

import { useState } from "react";
import { deleteSet, updateSet } from "@/app/workout/actions";
import { estimated1RM, roundTo } from "@/lib/lift/math";
import { SET_TYPE_LABELS, type LiftSet, type SetType } from "@/lib/lift/types";

const SET_TYPES = Object.keys(SET_TYPE_LABELS) as SetType[];

/**
 * One logged set, switchable into an edit form in place.
 *
 * The spec's review flagged that there was no way to correct a bad entry
 * without deleting and re-logging it (which also renumbers the sets after it).
 * Editing leaves set_number alone, so fixing a typo doesn't reorder anything.
 */
export default function SetRow({
  set,
  sessionId,
  editable,
}: {
  set: LiftSet;
  sessionId: string;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <tr className="border-t border-neutral-100">
        <td colSpan={6} className="py-2">
          <form
            action={updateSet}
            onSubmit={() => setEditing(false)}
            className="flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="setId" value={set.id} />
            <Field label="Weight" name="weight" defaultValue={set.weight} width="w-20" mode="decimal" />
            <Field label="Reps" name="reps" defaultValue={set.reps} width="w-16" mode="numeric" />
            <Field label="RPE" name="rpe" defaultValue={set.rpe} width="w-16" mode="decimal" />
            <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
              Type
              <select
                name="setType"
                defaultValue={set.set_type}
                className="rounded border border-neutral-300 px-2 py-1.5 text-base text-neutral-900"
              >
                {SET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SET_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <button className="rounded bg-neutral-900 px-3 py-2 text-sm text-white">Save</button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded border border-neutral-300 px-3 py-2 text-sm"
            >
              Cancel
            </button>
          </form>
        </td>
      </tr>
    );
  }

  const e1rm = estimated1RM(set.weight, set.reps);

  return (
    <tr className="border-t border-neutral-100">
      <td className="py-1.5 text-neutral-400">{set.set_number}</td>
      <td className="py-1.5 tabular-nums">{set.weight ?? "—"}</td>
      <td className="py-1.5 tabular-nums">{set.reps ?? "—"}</td>
      <td className="py-1.5 tabular-nums text-neutral-500">{set.rpe ?? ""}</td>
      <td className="py-1.5 text-neutral-500">
        {set.set_type === "working" ? (
          e1rm ? <span className="text-xs text-neutral-400">e1RM {roundTo(e1rm)}</span> : null
        ) : (
          SET_TYPE_LABELS[set.set_type]
        )}
      </td>
      <td className="py-1.5 text-right whitespace-nowrap">
        {editable ? (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="px-1 text-xs text-neutral-400 underline hover:text-neutral-900"
            >
              Edit
            </button>
            <form action={deleteSet} className="inline">
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="setId" value={set.id} />
              <button className="px-1 text-neutral-400 hover:text-red-600" aria-label="Delete set">
                ×
              </button>
            </form>
          </>
        ) : null}
      </td>
    </tr>
  );
}

function Field({
  label,
  name,
  defaultValue,
  width,
  mode,
}: {
  label: string;
  name: string;
  defaultValue: number | null;
  width: string;
  mode: "decimal" | "numeric";
}) {
  return (
    <label className={`flex ${width} flex-col gap-0.5 text-xs text-neutral-500`}>
      {label}
      <input
        name={name}
        inputMode={mode}
        defaultValue={defaultValue ?? ""}
        className="rounded border border-neutral-300 px-2 py-1.5 text-base text-neutral-900"
      />
    </label>
  );
}
