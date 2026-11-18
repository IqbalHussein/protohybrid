// Public API of the plan builder. Pure and deterministic: profile in, plan out.
// UI, server actions and (later) the coach import from here only.

export * from "./types";
export { PRESETS, presetWeights, matchPreset, rebalanceWeights, type PresetInfo } from "./presets";
export { validateProfile, MIN_DAYS, MAX_DAYS, MIN_MINUTES, MAX_MINUTES, type ProfileInput } from "./profile";
export { generatePlan, GENERATOR_VERSION } from "./generate";
export { CONSTRAINTS, type Constraint, type Violation } from "./constraints";
