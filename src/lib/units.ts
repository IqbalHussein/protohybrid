import type { WeightUnit } from "./types";

// Lift weights are stored in lb. These convert at the UI boundary.
export const LB_PER_KG = 2.2046226218;

// Stored lb -> number shown in the user's unit (1 decimal, trailing .0 dropped).
export function displayWeight(lb: number | null | undefined, unit: WeightUnit): number | null {
  if (lb === null || lb === undefined) return null;
  const value = unit === "kg" ? lb / LB_PER_KG : lb;
  return Math.round(value * 10) / 10;
}

export function formatWeight(lb: number | null | undefined, unit: WeightUnit): string {
  const v = displayWeight(lb, unit);
  return v === null ? "" : `${v} ${unit}`;
}

// Number entered in the user's unit -> lb for storage (rounded to 0.001 lb so
// kg entries round-trip exactly to 1 decimal).
export function toStoredWeight(value: number, unit: WeightUnit): number {
  const lb = unit === "kg" ? value * LB_PER_KG : value;
  return Math.round(lb * 1000) / 1000;
}
