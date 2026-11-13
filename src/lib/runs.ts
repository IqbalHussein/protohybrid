export { RUN_TYPES } from "./types";
export type { RunType } from "./types";

// Run time, pace and distance parsing/formatting. Distances are km and
// paces are seconds per km throughout.

// Accepts "mm:ss" or "h:mm:ss". Returns total seconds, or null if malformed.
export function parseDuration(input: string): number | null {
  const parts = input.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;

  const nums = parts.map(Number);
  const [h, m, s] = nums.length === 3 ? nums : [0, nums[0], nums[1]];
  if (s >= 60 || (nums.length === 3 && m >= 60)) return null;

  const total = h * 3600 + m * 60 + s;
  return total > 0 ? total : null;
}

export function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// "5:00" (per km); callers add the unit label.
export function formatPace(secPerKm: number): string {
  return formatDuration(secPerKm);
}

export function formatDistance(km: number): string {
  return String(Math.round(km * 100) / 100);
}

export function runTypeLabel(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
