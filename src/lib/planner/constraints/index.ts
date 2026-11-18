import type { GeneratedBlock } from "../types";
import { avoidBackToBackHard } from "./avoidBackToBackHard";
import { avoidLegsAfterHardRun } from "./avoidLegsAfterHardRun";
import { deloadReduction } from "./deloadReduction";
import { liftProgression } from "./liftProgression";
import { longRunWhenEndurance } from "./longRunWhenEndurance";
import { maxConsecutiveHardDays } from "./maxConsecutiveHardDays";
import { minSessionLength } from "./minSessionLength";
import { noHeavyLowerBeforeHardRun } from "./noHeavyLowerBeforeHardRun";
import { protectLongRun } from "./protectLongRun";
import { respectRestDays } from "./respectRestDays";
import { runIntensityDistribution } from "./runIntensityDistribution";
import { runVolumeProgression } from "./runVolumeProgression";
import { spreadKeyRuns } from "./spreadKeyRuns";
import { spreadLifts } from "./spreadLifts";
import { stackHardSessions } from "./stackHardSessions";
import { timeBudget } from "./timeBudget";
import type { Constraint, WeekLayout } from "./types";

export type { Constraint, Violation, WeekLayout, DayLayout, LayoutSession } from "./types";

export const WEEK_CONSTRAINTS: readonly Constraint<WeekLayout>[] = [
  timeBudget,
  noHeavyLowerBeforeHardRun,
  maxConsecutiveHardDays,
  minSessionLength,
  runIntensityDistribution,
  longRunWhenEndurance,
  stackHardSessions,
  respectRestDays,
  protectLongRun,
  avoidLegsAfterHardRun,
  spreadLifts,
  spreadKeyRuns,
  avoidBackToBackHard,
];

export const BLOCK_CONSTRAINTS: readonly Constraint<GeneratedBlock>[] = [
  runVolumeProgression,
  deloadReduction,
  liftProgression,
];

export const CONSTRAINTS: readonly (Constraint<WeekLayout> | Constraint<GeneratedBlock>)[] = [
  ...WEEK_CONSTRAINTS,
  ...BLOCK_CONSTRAINTS,
];

export {
  timeBudget,
  noHeavyLowerBeforeHardRun,
  maxConsecutiveHardDays,
  minSessionLength,
  runIntensityDistribution,
  longRunWhenEndurance,
  stackHardSessions,
  respectRestDays,
  protectLongRun,
  avoidLegsAfterHardRun,
  spreadLifts,
  spreadKeyRuns,
  avoidBackToBackHard,
  runVolumeProgression,
  deloadReduction,
  liftProgression,
};
