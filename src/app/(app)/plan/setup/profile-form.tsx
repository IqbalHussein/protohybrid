"use client";

import { useActionState, useState, type ReactNode } from "react";
import {
  MAX_DAYS,
  MAX_MINUTES,
  MIN_DAYS,
  MIN_MINUTES,
  PRESETS,
  matchPreset,
  presetWeights,
  rebalanceWeights,
  type Experience,
  type FocusWeights,
  type Preset,
  type TrainingProfile,
} from "@/lib/planner";
import { cn } from "@/lib/cn";
import { Field, Input } from "@/components/ui/field";
import { FormMessage, type ActionState } from "@/components/ui/form-message";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveProfile } from "../actions";

const DEFAULT_PROFILE: TrainingProfile = {
  preset: "hybrid",
  weights: presetWeights("hybrid"),
  daysPerWeek: 4,
  minutesPerDay: 60,
  restDays: [],
  goal: { type: "none" },
  experience: "intermediate",
};

const MINUTE_CHIPS = [30, 45, 60, 75, 90];
const DISTANCES = [
  { label: "5k", km: 5 },
  { label: "10k", km: 10 },
  { label: "Half", km: 21.1 },
  { label: "Marathon", km: 42.2 },
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const EXPERIENCE: { id: Experience; label: string }[] = [
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
];
const GOALS = [
  { id: "none", label: "None" },
  { id: "race", label: "Race" },
  { id: "strength", label: "Strength" },
] as const;
type GoalType = (typeof GOALS)[number]["id"];

const WEIGHT_FIELDS: { key: keyof FocusWeights; label: string; bar: string }[] = [
  { key: "strength", label: "Strength", bar: "bg-lift" },
  { key: "hypertrophy", label: "Hypertrophy", bar: "bg-lift-strong" },
  { key: "endurance", label: "Endurance", bar: "bg-run" },
];

const chip =
  "inline-flex min-h-11 items-center justify-center rounded-control border px-4 text-sm font-semibold transition-colors";
const chipOff = "border-ink-line-strong text-chalk hover:bg-ink-raised";
const chipOn = "border-chalk bg-chalk text-ink";

// A native radio styled as a chip/card: keyboard and screen readers get real
// radio-group behaviour; the label span carries the visuals.
function Choice({
  name,
  value,
  checked,
  onChange,
  className,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className="relative flex">
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="peer sr-only" />
      <span
        className={cn(
          "flex w-full flex-1 cursor-pointer text-sm transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-chalk",
          className,
          checked ? chipOn : chipOff,
        )}
      >
        {children}
      </span>
    </label>
  );
}

function Group({ legend, hint, children }: { legend: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="stretch-semi mb-1 text-base font-bold">{legend}</legend>
      {hint && <p className="-mt-1 text-xs text-chalk-faint">{hint}</p>}
      {children}
    </fieldset>
  );
}

export function ProfileForm({ initial }: { initial: TrainingProfile | null }) {
  const start = initial ?? DEFAULT_PROFILE;
  const [state, action] = useActionState<ActionState, FormData>(saveProfile, {});

  const [weights, setWeights] = useState<FocusWeights>(start.weights);
  const [days, setDays] = useState(start.daysPerWeek);
  const [minutes, setMinutes] = useState(String(start.minutesPerDay));
  const [restDays, setRestDays] = useState<number[]>(start.restDays);
  const [goalType, setGoalType] = useState<GoalType>(start.goal.type);
  const [raceKm, setRaceKm] = useState(start.goal.type === "race" ? String(start.goal.distanceKm) : "");
  const [raceDate, setRaceDate] = useState(start.goal.type === "race" ? start.goal.date : "");
  const [experience, setExperience] = useState<Experience>(start.experience);

  const preset: Preset | null = matchPreset(weights);
  const minutesNum = Number(minutes);
  const availableDays = 7 - restDays.length;

  const payload = {
    preset,
    weights,
    daysPerWeek: days,
    minutesPerDay: minutes === "" ? null : minutesNum,
    // Per-weekday overrides aren't editable here; keep any the user already has.
    ...(start.minutesByWeekday ? { minutesByWeekday: start.minutesByWeekday } : {}),
    restDays,
    goal:
      goalType === "race"
        ? { type: "race", distanceKm: raceKm, date: raceDate }
        : { type: goalType },
    experience,
  };

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      <Panel className="flex flex-col gap-5">
        <Group legend="What kind of athlete?" hint="A starting point. Fine-tune the mix below.">
          <div role="radiogroup" aria-label="Preset" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PRESETS.map((p) => (
              <Choice
                key={p.id}
                name="preset"
                value={p.id}
                checked={preset === p.id}
                onChange={() => setWeights({ ...p.weights })}
                className="min-h-20 flex-col justify-center gap-0.5 rounded-panel border px-3 py-2"
              >
                <span className="stretch-semi text-base font-bold">{p.label}</span>
                <span className={cn("text-xs", preset === p.id ? "text-ink" : "text-chalk-muted")}>
                  {p.weights.strength}/{p.weights.hypertrophy}/{p.weights.endurance}
                </span>
                <span className={cn("text-xs", preset === p.id ? "text-ink" : "text-chalk-faint")}>{p.blurb}</span>
              </Choice>
            ))}
          </div>
        </Group>

        <Group legend="Focus mix">
          <p className="-mt-2 text-xs text-chalk-faint" aria-live="polite">
            {preset ? `${PRESETS.find((p) => p.id === preset)?.label} mix.` : "Custom mix."} Always adds up to 100.
          </p>
          <div
            role="img"
            aria-label={`Strength ${weights.strength}, hypertrophy ${weights.hypertrophy}, endurance ${weights.endurance}`}
            className="flex h-3 w-full overflow-hidden rounded-full bg-ink-sunken"
          >
            {WEIGHT_FIELDS.map((f) => (
              <div key={f.key} className={f.bar} style={{ width: `${weights[f.key]}%` }} />
            ))}
          </div>
          <div className="flex flex-col gap-1">
            {WEIGHT_FIELDS.map((f) => (
              <label key={f.key} className="flex min-h-11 items-center gap-3">
                <span className="flex w-28 shrink-0 items-center gap-2 text-sm font-medium">
                  <span aria-hidden className={cn("inline-block size-3 rounded-sm", f.bar)} />
                  {f.label}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={weights[f.key]}
                  onChange={(e) => setWeights(rebalanceWeights(weights, f.key, Number(e.target.value)))}
                  className="h-11 min-w-0 flex-1 accent-chalk"
                  aria-valuetext={`${weights[f.key]} percent`}
                />
                <span className="w-10 shrink-0 text-right text-sm font-bold tabular-nums">{weights[f.key]}</span>
              </label>
            ))}
          </div>
        </Group>
      </Panel>

      <Panel className="flex flex-col gap-6">
        <Group legend="Training days per week">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Fewer days"
              disabled={days <= MIN_DAYS}
              onClick={() => setDays((d) => Math.max(MIN_DAYS, d - 1))}
              className={cn(chip, chipOff, "w-12 text-lg disabled:opacity-40")}
            >
              −
            </button>
            <output aria-live="polite" aria-label="Days per week" className="stretch-wide w-10 text-center text-3xl font-extrabold tabular-nums">
              {days}
            </output>
            <button
              type="button"
              aria-label="More days"
              disabled={days >= MAX_DAYS}
              onClick={() => setDays((d) => Math.min(MAX_DAYS, d + 1))}
              className={cn(chip, chipOff, "w-12 text-lg disabled:opacity-40")}
            >
              +
            </button>
          </div>
        </Group>

        <Group legend="Minutes per training day" hint="Minutes are per training day. Two sessions on one day share them.">
          <div className="flex flex-wrap gap-2">
            {MINUTE_CHIPS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={minutesNum === m}
                onClick={() => setMinutes(String(m))}
                className={cn(chip, "min-w-14", minutesNum === m ? chipOn : chipOff)}
              >
                {m}
              </button>
            ))}
          </div>
          <Field label="Or enter minutes" className="max-w-40">
            <Input
              type="number"
              inputMode="numeric"
              min={MIN_MINUTES}
              max={MAX_MINUTES}
              step={5}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="h-11"
            />
          </Field>
        </Group>

        <Group legend="Preferred rest days (optional)" hint="Used when it fits. The planner avoids these days first.">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {WEEKDAYS.map((label, i) => {
              const day = i + 1;
              const on = restDays.includes(day);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setRestDays((r) => (on ? r.filter((d) => d !== day) : [...r, day].sort((a, b) => a - b)))}
                  className={cn(chip, on ? chipOn : chipOff)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {availableDays < days && (
            <p role="status" className="text-xs text-chalk-muted">
              Only {availableDays} non-rest {availableDays === 1 ? "day" : "days"} left for {days} training days, so some rest days will be used.
            </p>
          )}
        </Group>
      </Panel>

      <Panel className="flex flex-col gap-6">
        <Group legend="Goal">
          <div role="radiogroup" aria-label="Goal" className="grid grid-cols-3 gap-2">
            {GOALS.map((g) => (
              <Choice
                key={g.id}
                name="goal"
                value={g.id}
                checked={goalType === g.id}
                onChange={() => setGoalType(g.id)}
                className={cn(chip, "justify-center")}
              >
                {g.label}
              </Choice>
            ))}
          </div>
          {goalType === "strength" && (
            <p className="text-xs text-chalk-muted">The plan will lean toward heavier lifting and protect it from hard runs.</p>
          )}
          {goalType === "race" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-chalk-muted">Distance</span>
                <div className="flex flex-wrap gap-2">
                  {DISTANCES.map((d) => (
                    <button
                      key={d.label}
                      type="button"
                      aria-pressed={Number(raceKm) === d.km}
                      onClick={() => setRaceKm(String(d.km))}
                      className={cn(chip, Number(raceKm) === d.km ? chipOn : chipOff)}
                    >
                      {d.label} <span className="ml-1 text-xs font-medium opacity-70">{d.km}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Distance (km)">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0.1}
                    max={1000}
                    step={0.1}
                    value={raceKm}
                    onChange={(e) => setRaceKm(e.target.value)}
                    className="h-11"
                  />
                </Field>
                <Field label="Race date">
                  <Input type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)} className="h-11" />
                </Field>
              </div>
            </div>
          )}
        </Group>

        <Group legend="Experience">
          <div role="radiogroup" aria-label="Experience" className="grid grid-cols-3 gap-2">
            {EXPERIENCE.map((x) => (
              <Choice
                key={x.id}
                name="experience"
                value={x.id}
                checked={experience === x.id}
                onChange={() => setExperience(x.id)}
                className={cn(chip, "justify-center px-2 text-center")}
              >
                {x.label}
              </Choice>
            ))}
          </div>
        </Group>
      </Panel>

      <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] -mx-4 flex flex-col gap-2 border-t border-ink-line bg-ink/95 px-4 py-3 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
        <FormMessage state={state} />
        <SubmitButton pendingLabel="Building…" className="h-12 w-full sm:w-auto sm:self-start sm:px-8">
          See my plan
        </SubmitButton>
      </div>
    </form>
  );
}
