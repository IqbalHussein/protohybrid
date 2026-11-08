"use client";

import { useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { ExerciseOption } from "./data";

const MAX_RESULTS = 50;

type Option = { kind: "exercise"; exercise: ExerciseOption } | { kind: "create"; name: string };

// Searchable exercise combobox (WAI-ARIA combobox + listbox pattern).
// With an empty query it suggests `suggestedIds` (recently used) first.
export function ExercisePicker({
  label,
  exercises,
  value,
  onChange,
  onCreate,
  suggestedIds = [],
}: {
  label: string;
  exercises: ExerciseOption[];
  value: string | null;
  onChange: (id: string) => void;
  onCreate?: (name: string) => Promise<string | null>; // resolves to an error message or null
  suggestedIds?: string[];
}) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  const selected = value ? byId.get(value) : undefined;

  const options: Option[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    let matches: ExerciseOption[];
    if (!q) {
      const suggested = suggestedIds.map((sid) => byId.get(sid)).filter((e): e is ExerciseOption => !!e);
      const rest = exercises.filter((e) => !suggestedIds.includes(e.id));
      matches = [...suggested, ...rest].slice(0, MAX_RESULTS);
    } else {
      // Names that start with the query rank above names that merely contain it.
      const starts: ExerciseOption[] = [];
      const contains: ExerciseOption[] = [];
      for (const e of exercises) {
        const n = e.name.toLowerCase();
        if (n.startsWith(q)) starts.push(e);
        else if (n.includes(q)) contains.push(e);
        if (starts.length >= MAX_RESULTS) break;
      }
      matches = [...starts, ...contains].slice(0, MAX_RESULTS);
    }
    const list: Option[] = matches.map((exercise) => ({ kind: "exercise", exercise }));
    const trimmed = query.trim();
    if (onCreate && trimmed && !exercises.some((e) => e.name.toLowerCase() === trimmed.toLowerCase())) {
      list.push({ kind: "create", name: trimmed });
    }
    return list;
  }, [query, exercises, byId, suggestedIds, onCreate]);

  function openList() {
    setOpen(true);
    setActive(0);
  }

  function close() {
    setOpen(false);
    setQuery("");
  }

  async function choose(option: Option | undefined) {
    if (!option) return;
    if (option.kind === "exercise") {
      onChange(option.exercise.id);
      close();
      return;
    }
    if (!onCreate) return;
    setCreating(true);
    setCreateError(null);
    const error = await onCreate(option.name);
    setCreating(false);
    if (error) setCreateError(error);
    else close();
  }

  const activeOption = open ? options[active] : undefined;
  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={`${id}-input`} className="text-sm font-medium text-chalk-muted">
        {label}
      </label>
      <input
        ref={inputRef}
        id={`${id}-input`}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? optionId(active) : undefined}
        autoComplete="off"
        placeholder={selected ? undefined : "Search exercises"}
        value={open ? query : selected?.name ?? ""}
        disabled={creating}
        onFocus={openList}
        onClick={() => !open && openList()}
        onBlur={close}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
          setCreateError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) openList();
            else setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            if (open) {
              e.preventDefault();
              void choose(options[active]);
            }
          } else if (e.key === "Escape") {
            if (open) {
              e.preventDefault();
              close();
            }
          }
        }}
        className={cn(
          "h-10 w-full rounded-control border border-ink-line-strong bg-ink-sunken px-3 text-sm text-chalk",
          "placeholder:text-chalk-faint hover:border-chalk-faint focus:border-chalk-muted",
          !selected && !open && "text-chalk-faint",
        )}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-control border border-ink-line-strong bg-ink-raised py-1"
        >
          {options.length === 0 && <li className="px-3 py-2 text-sm text-chalk-faint">No exercises match.</li>}
          {options.map((o, i) => (
            <li
              key={o.kind === "exercise" ? o.exercise.id : "create"}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              // mousedown keeps focus in the input so blur doesn't close first
              onMouseDown={(e) => {
                e.preventDefault();
                void choose(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-sm",
                i === active ? "bg-ink-sunken text-chalk" : "text-chalk-muted",
              )}
            >
              {o.kind === "exercise" ? (
                <>
                  <span className={cn(o.exercise.id === value && "font-semibold text-lift-strong")}>{o.exercise.name}</span>
                  <span className="shrink-0 text-xs text-chalk-faint">
                    {o.exercise.is_custom ? "Custom" : o.exercise.muscle_group ?? ""}
                  </span>
                </>
              ) : (
                <span>Create custom exercise &ldquo;{o.name}&rdquo;</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {creating && <span className="text-xs text-chalk-faint">Creating exercise…</span>}
      {createError && (
        <span role="alert" className="text-xs text-danger">
          {createError}
        </span>
      )}
    </div>
  );
}
