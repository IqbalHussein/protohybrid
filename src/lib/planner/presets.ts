import type { FocusWeights, Preset } from "./types";

export type PresetInfo = { id: Preset; label: string; blurb: string; weights: FocusWeights };

// Starting weights only: the user can adjust them afterwards.
export const PRESETS: readonly PresetInfo[] = [
  { id: "builder", label: "Builder", blurb: "Muscle first, some running", weights: { strength: 20, hypertrophy: 65, endurance: 15 } },
  { id: "lifter", label: "Lifter", blurb: "Get stronger, stay fit", weights: { strength: 65, hypertrophy: 20, endurance: 15 } },
  { id: "runner", label: "Runner", blurb: "Run more, lift to support it", weights: { strength: 20, hypertrophy: 10, endurance: 70 } },
  { id: "hybrid", label: "Hybrid", blurb: "Balanced lifting and running", weights: { strength: 35, hypertrophy: 25, endurance: 40 } },
];

export function presetWeights(id: Preset): FocusWeights {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown preset: ${id}`);
  return { ...p.weights };
}

// The preset whose weights match exactly, or null.
export function matchPreset(w: FocusWeights): Preset | null {
  return (
    PRESETS.find(
      (p) => p.weights.strength === w.strength && p.weights.hypertrophy === w.hypertrophy && p.weights.endurance === w.endurance,
    )?.id ?? null
  );
}

type Key = keyof FocusWeights;
const KEYS: Key[] = ["strength", "hypertrophy", "endurance"];

// Sets one weight and rebalances the other two to keep the total at 100,
// in proportion to their current values (evenly if both are 0). Integer
// results; the slider UI uses this.
export function rebalanceWeights(current: FocusWeights, key: Key, value: number): FocusWeights {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const others = KEYS.filter((k) => k !== key);
  const rest = 100 - v;
  const sum = others.reduce((s, k) => s + current[k], 0);
  const out = { ...current, [key]: v } as FocusWeights;
  if (sum === 0) {
    out[others[0]] = Math.ceil(rest / 2);
    out[others[1]] = Math.floor(rest / 2);
  } else {
    const first = Math.round((current[others[0]] / sum) * rest);
    out[others[0]] = first;
    out[others[1]] = rest - first;
  }
  return out;
}
