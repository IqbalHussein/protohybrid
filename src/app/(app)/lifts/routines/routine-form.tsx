"use client";

import { useActionState, useRef, useState } from "react";
import type { RoutineFormPayload } from "@/lib/lifts";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage, type ActionState } from "@/components/ui/form-message";
import { createCustomExercise, saveRoutine } from "../actions";
import { ExercisePicker } from "../exercise-picker";
import type { ExerciseOption } from "../data";

type Item = { key: number; exerciseId: string | null; targetSets: string; targetReps: string };

export function RoutineForm({
  routineId,
  initialName,
  initialItems,
  exercises: initialExercises,
  suggestedIds,
}: {
  routineId: string | null;
  initialName: string;
  initialItems: Omit<Item, "key">[];
  exercises: ExerciseOption[];
  suggestedIds: string[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveRoutine, {});
  const nextKey = useRef(0);
  const key = () => ++nextKey.current;
  const blank = (): Item => ({ key: key(), exerciseId: null, targetSets: "3", targetReps: "8" });

  const [exercises, setExercises] = useState(initialExercises);
  const [name, setName] = useState(initialName);
  const [items, setItems] = useState<Item[]>(() =>
    initialItems.length ? initialItems.map((i) => ({ ...i, key: key() })) : [blank()],
  );

  const payload: RoutineFormPayload = {
    routineId,
    name,
    exercises: items.map(({ exerciseId, targetSets, targetReps }) => ({ exerciseId, targetSets, targetReps })),
  };

  const update = (k: number, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === k ? { ...i, ...patch } : i)));
  const move = (index: number, delta: number) =>
    setItems((list) => {
      const to = index + delta;
      if (to < 0 || to >= list.length) return list;
      const copy = [...list];
      [copy[index], copy[to]] = [copy[to], copy[index]];
      return copy;
    });

  async function createExercise(exerciseName: string, k: number): Promise<string | null> {
    const res = await createCustomExercise(exerciseName);
    if ("error" in res) return res.error;
    setExercises((list) =>
      list.some((e) => e.id === res.exercise.id) ? list : [...list, res.exercise].sort((a, b) => a.name.localeCompare(b.name)),
    );
    update(k, { exerciseId: res.exercise.id });
    return null;
  }

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <Field label="Routine name" className="max-w-md">
        <Input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Leg day" />
      </Field>

      <ol className="flex flex-col gap-3">
        {items.map((item, i) => (
          <li
            key={item.key}
            className="grid gap-3 rounded-panel border border-ink-line bg-ink-raised p-4 sm:grid-cols-[2rem_1fr_6rem_6rem_auto] sm:items-end"
          >
            <span className="stretch-semi pb-2 text-sm font-bold text-chalk-muted">{i + 1}</span>
            <ExercisePicker
              label={`Exercise ${i + 1}`}
              exercises={exercises}
              value={item.exerciseId}
              suggestedIds={suggestedIds}
              onChange={(id) => update(item.key, { exerciseId: id })}
              onCreate={(n) => createExercise(n, item.key)}
            />
            <Field label="Sets">
              <Input
                type="number"
                min="1"
                max="50"
                step="1"
                inputMode="numeric"
                value={item.targetSets}
                onChange={(e) => update(item.key, { targetSets: e.target.value })}
              />
            </Field>
            <Field label="Reps">
              <Input
                type="number"
                min="1"
                max="1000"
                step="1"
                inputMode="numeric"
                value={item.targetReps}
                onChange={(e) => update(item.key, { targetReps: e.target.value })}
              />
            </Field>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move exercise ${i + 1} up`}>
                Up
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={i === items.length - 1}
                onClick={() => move(i, 1)}
                aria-label={`Move exercise ${i + 1} down`}
              >
                Down
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={items.length === 1}
                onClick={() => setItems((list) => list.filter((x) => x.key !== item.key))}
                aria-label={`Remove exercise ${i + 1}`}
              >
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="secondary" onClick={() => setItems((list) => [...list, blank()])}>
          Add exercise
        </Button>
        <div className="flex flex-wrap items-center gap-4">
          <FormMessage state={state} />
          <SubmitButton variant="lift" pendingLabel="Saving…">
            Save routine
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
