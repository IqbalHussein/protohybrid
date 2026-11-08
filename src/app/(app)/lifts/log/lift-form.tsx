"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { LIFT_FOCUSES, SET_TYPES, type SetType, type WeightUnit } from "@/lib/types";
import { SET_TYPE_LABELS, focusLabel, type LiftFormPayload } from "@/lib/lifts";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage, type ActionState } from "@/components/ui/form-message";
import { createCustomExercise, logLift } from "../actions";
import { ExercisePicker } from "../exercise-picker";
import type { ExerciseOption } from "../data";
import { RestTimer } from "./rest-timer";

// original: the stored lb value and the text first shown for it, so an
// untouched weight is saved exactly instead of re-converted from a rounded value.
export type InitialSet = {
  setType: SetType;
  reps: string;
  weight: string;
  rpe: string;
  original?: { shown: string; lb: number };
};
export type InitialGroup = { exerciseId: string | null; sets: InitialSet[] };
export type LiftFormInitial = {
  sessionId: string | null;
  date: string;
  focus: string;
  notes: string;
  groups: InitialGroup[];
};

type SetRow = InitialSet & { key: number };
type Group = { key: number; exerciseId: string | null; sets: SetRow[] };

const DEFAULT_REST = 90;
const emptySet = (): InitialSet => ({ setType: "working", reps: "", weight: "", rpe: "" });

export function LiftForm({
  initial,
  exercises: initialExercises,
  restPrefs,
  suggestedIds,
  unit,
  submitLabel,
}: {
  initial: LiftFormInitial;
  exercises: ExerciseOption[];
  restPrefs: Record<string, number>;
  suggestedIds: string[];
  unit: WeightUnit;
  submitLabel: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(logLift, {});
  const nextKey = useRef(0);
  const key = () => ++nextKey.current;

  const [exercises, setExercises] = useState(initialExercises);
  const [date, setDate] = useState(initial.date);
  const [focus, setFocus] = useState(initial.focus);
  const [notes, setNotes] = useState(initial.notes);
  const [groups, setGroups] = useState<Group[]>(() => {
    const source = initial.groups.length ? initial.groups : [{ exerciseId: null, sets: [emptySet()] }];
    return source.map((g) => ({
      key: key(),
      exerciseId: g.exerciseId,
      sets: (g.sets.length ? g.sets : [emptySet()]).map((s) => ({ ...s, key: key() })),
    }));
  });

  const names = useMemo(() => new Map(exercises.map((e) => [e.id, e.name])), [exercises]);
  const focusOptions = useMemo(() => {
    const list: string[] = [...LIFT_FOCUSES];
    if (initial.focus && !list.includes(initial.focus)) list.unshift(initial.focus);
    return list;
  }, [initial.focus]);

  const payload: LiftFormPayload = {
    sessionId: initial.sessionId,
    date,
    focus,
    notes,
    groups: groups.map((g) => ({
      exerciseId: g.exerciseId,
      sets: g.sets.map(({ setType, reps, weight, rpe, original }) => ({ setType, reps, weight, rpe, original })),
    })),
  };

  function updateGroup(gk: number, fn: (g: Group) => Group) {
    setGroups((gs) => gs.map((g) => (g.key === gk ? fn(g) : g)));
  }

  function updateSet(gk: number, sk: number, patch: Partial<InitialSet>) {
    updateGroup(gk, (g) => ({ ...g, sets: g.sets.map((s) => (s.key === sk ? { ...s, ...patch } : s)) }));
  }

  async function createExercise(name: string, gk: number): Promise<string | null> {
    const res = await createCustomExercise(name);
    if ("error" in res) return res.error;
    setExercises((list) =>
      list.some((e) => e.id === res.exercise.id)
        ? list
        : [...list, res.exercise].sort((a, b) => a.name.localeCompare(b.name)),
    );
    updateGroup(gk, (g) => ({ ...g, exerciseId: res.exercise.id }));
    return null;
  }

  return (
    <form action={action} className="flex flex-col gap-8">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      <div className="grid gap-4 sm:grid-cols-[10rem_12rem_1fr]">
        <Field label="Date">
          <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Focus">
          <Select required value={focus} onChange={(e) => setFocus(e.target.value)}>
            {focusOptions.map((f) => (
              <option key={f} value={f}>
                {focusLabel(f)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes (optional)">
          <Textarea rows={1} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      <ol className="flex flex-col gap-6">
        {groups.map((g, gi) => {
          const exerciseName = g.exerciseId ? names.get(g.exerciseId) ?? "this exercise" : null;
          return (
            <li key={g.key} className="flex flex-col gap-4 rounded-panel border border-ink-line bg-ink-raised p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <ExercisePicker
                    label={`Exercise ${gi + 1}`}
                    exercises={exercises}
                    value={g.exerciseId}
                    suggestedIds={suggestedIds}
                    onChange={(id) => updateGroup(g.key, (x) => ({ ...x, exerciseId: id }))}
                    onCreate={(name) => createExercise(name, g.key)}
                  />
                </div>
                {groups.length > 1 && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setGroups((gs) => gs.filter((x) => x.key !== g.key))}
                    aria-label={`Remove exercise ${gi + 1}`}
                  >
                    Remove exercise
                  </Button>
                )}
              </div>

              {g.exerciseId && exerciseName && (
                <RestTimer
                  key={g.exerciseId}
                  exerciseId={g.exerciseId}
                  exerciseName={exerciseName}
                  initialSeconds={restPrefs[g.exerciseId] ?? DEFAULT_REST}
                />
              )}

              <div className="flex flex-col gap-2">
                <div className="hidden grid-cols-[2rem_8rem_1fr_1fr_1fr_auto] gap-2 px-1 text-xs text-chalk-faint sm:grid">
                  <span>Set</span>
                  <span>Type</span>
                  <span>Reps</span>
                  <span>Weight ({unit})</span>
                  <span>RPE</span>
                  <span className="w-16" />
                </div>
                {g.sets.map((s, si) => {
                  const label = `Exercise ${gi + 1} set ${si + 1}`;
                  return (
                    <div
                      key={s.key}
                      className="grid grid-cols-[2rem_1fr_1fr] items-center gap-2 sm:grid-cols-[2rem_8rem_1fr_1fr_1fr_auto]"
                    >
                      <span className="stretch-semi text-sm font-bold text-chalk-muted">{si + 1}</span>
                      <Select
                        aria-label={`${label} type`}
                        value={s.setType}
                        onChange={(e) => updateSet(g.key, s.key, { setType: e.target.value as SetType })}
                        className="col-span-2 sm:col-span-1"
                      >
                        {SET_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {SET_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </Select>
                      <span className="sm:hidden" />
                      <Input
                        aria-label={`${label} reps`}
                        placeholder="Reps"
                        type="number"
                        min="0"
                        max="1000"
                        step="1"
                        inputMode="numeric"
                        value={s.reps}
                        onChange={(e) => updateSet(g.key, s.key, { reps: e.target.value })}
                      />
                      <Input
                        aria-label={`${label} weight in ${unit}`}
                        placeholder={unit}
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        value={s.weight}
                        onChange={(e) => updateSet(g.key, s.key, { weight: e.target.value })}
                      />
                      <span className="sm:hidden" />
                      <Input
                        aria-label={`${label} RPE`}
                        placeholder="RPE"
                        type="number"
                        min="1"
                        max="10"
                        step="0.5"
                        inputMode="decimal"
                        value={s.rpe}
                        onChange={(e) => updateSet(g.key, s.key, { rpe: e.target.value })}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-16"
                        disabled={g.sets.length === 1}
                        onClick={() => updateGroup(g.key, (x) => ({ ...x, sets: x.sets.filter((y) => y.key !== s.key) }))}
                        aria-label={`Remove ${label}`}
                      >
                        Remove
                      </Button>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => updateGroup(g.key, (x) => ({ ...x, sets: [...x.sets, { ...emptySet(), key: key() }] }))}
                >
                  Add set
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    updateGroup(g.key, (x) => {
                      const last = x.sets[x.sets.length - 1];
                      return { ...x, sets: [...x.sets, { ...(last ?? emptySet()), key: key() }] };
                    })
                  }
                >
                  Copy last set
                </Button>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="secondary"
          onClick={() => setGroups((gs) => [...gs, { key: key(), exerciseId: null, sets: [{ ...emptySet(), key: key() }] }])}
        >
          Add exercise
        </Button>
        <div className="flex flex-wrap items-center gap-4">
          <FormMessage state={state} />
          <SubmitButton variant="lift" pendingLabel="Saving…">
            {submitLabel}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
