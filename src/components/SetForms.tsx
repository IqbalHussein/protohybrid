"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { addSet, deleteSet, updateSet } from "@/app/workout/actions";
import type { LiftSet, SetType } from "@/lib/lift/types";
import { startRestTimer } from "./RestTimer";

const inputClass = "rounded border border-neutral-300 px-2 py-1.5 text-base text-neutral-900";

function Submit({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className={`${className} disabled:opacity-50`}>
      {children}
    </button>
  );
}

function SetTypeSelect({ defaultValue }: { defaultValue: SetType }) {
  return (
    <select name="setType" defaultValue={defaultValue} className={inputClass}>
      <option value="working">Working</option>
      <option value="warmup">Warm-up</option>
      <option value="drop">Drop</option>
      <option value="failure">Failure</option>
    </select>
  );
}

// New-set row. Previous performance shows as placeholder text, and logging a
// set with the fields left blank logs exactly that — most sets are "same as
// last time", which is what makes this as fast as a note.
export function SetForm({
  sessionId,
  exerciseId,
  prevWeight,
  prevReps,
  restSeconds,
  showRpe,
}: {
  sessionId: string;
  exerciseId: string;
  prevWeight: number | null;
  prevReps: number | null;
  restSeconds: number | null;
  showRpe: boolean;
}) {
  const [rpe, setRpe] = useState(showRpe);

  async function action(formData: FormData) {
    if (!String(formData.get("weight") ?? "").trim() && prevWeight != null) {
      formData.set("weight", String(prevWeight));
    }
    if (!String(formData.get("reps") ?? "").trim() && prevReps != null) {
      formData.set("reps", String(prevReps));
    }
    await addSet(formData);
    if (formData.get("setType") === "working" && restSeconds) startRestTimer(restSeconds);
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-2 pt-1">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="exerciseId" value={exerciseId} />
      <label className="flex w-20 flex-col gap-0.5 text-xs text-neutral-500">
        Weight
        <input
          name="weight"
          inputMode="decimal"
          placeholder={prevWeight != null ? String(prevWeight) : "lb"}
          className={inputClass}
        />
      </label>
      <label className="flex w-16 flex-col gap-0.5 text-xs text-neutral-500">
        Reps
        <input name="reps" inputMode="numeric" placeholder={prevReps != null ? String(prevReps) : ""} className={inputClass} />
      </label>
      {rpe ? (
        <label className="flex w-16 flex-col gap-0.5 text-xs text-neutral-500">
          RPE
          <input name="rpe" inputMode="decimal" className={inputClass} />
        </label>
      ) : null}
      <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
        Type
        <SetTypeSelect defaultValue="working" />
      </label>
      <Submit className="rounded bg-neutral-900 px-3 py-2 text-sm text-white">Log set</Submit>
      <div className="flex w-full items-baseline justify-between text-xs text-neutral-400">
        <span>
          {prevWeight != null || prevReps != null
            ? `Last time: ${prevWeight ?? "—"} × ${prevReps ?? "—"} · blank fields repeat it`
            : "First time logging this exercise"}
        </span>
        {!rpe ? (
          <button type="button" onClick={() => setRpe(true)} className="underline">
            Add RPE
          </button>
        ) : null}
      </div>
    </form>
  );
}

// One logged set, editable in place.
export function SetRow({ set, sessionId, editable }: { set: LiftSet; sessionId: string; editable: boolean }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <tr className="border-t border-neutral-100">
        <td className="py-1.5 align-top text-neutral-400">{set.set_number}</td>
        <td colSpan={5} className="py-1.5">
          <form
            action={async (fd) => {
              await updateSet(fd);
              setEditing(false);
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="setId" value={set.id} />
            <input name="weight" defaultValue={set.weight ?? ""} inputMode="decimal" aria-label="Weight" className={`${inputClass} w-20`} />
            <input name="reps" defaultValue={set.reps ?? ""} inputMode="numeric" aria-label="Reps" className={`${inputClass} w-16`} />
            <input name="rpe" defaultValue={set.rpe ?? ""} inputMode="decimal" aria-label="RPE" placeholder="RPE" className={`${inputClass} w-16`} />
            <SetTypeSelect defaultValue={set.set_type} />
            <Submit className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">Save</Submit>
            <button type="button" onClick={() => setEditing(false)} className="text-sm text-neutral-500 underline">
              Cancel
            </button>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-neutral-100">
      <td className="py-1.5 text-neutral-400">{set.set_number}</td>
      <td className="py-1.5">{set.weight ?? "—"}</td>
      <td className="py-1.5">{set.reps ?? "—"}</td>
      <td className="py-1.5 text-neutral-500">{set.rpe ?? ""}</td>
      <td className="py-1.5 text-neutral-500">{set.set_type === "working" ? "" : set.set_type}</td>
      <td className="py-1.5 text-right">
        {editable ? (
          <span className="inline-flex items-center gap-3">
            <button type="button" onClick={() => setEditing(true)} className="text-xs text-neutral-400 underline hover:text-neutral-700">
              Edit
            </button>
            <form action={deleteSet} className="inline">
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="setId" value={set.id} />
              <button className="text-neutral-400 hover:text-red-600" aria-label="Delete set">
                ×
              </button>
            </form>
          </span>
        ) : null}
      </td>
    </tr>
  );
}
