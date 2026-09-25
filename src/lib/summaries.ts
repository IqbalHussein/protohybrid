import type { SessionRow } from "@/lib/calendar";
import { formatKm, formatPace, formatSeconds } from "@/lib/format";

// One-line planned/actual descriptions shared by the calendar cards and the
// session page.

export function plannedSummary(s: SessionRow): string | null {
  if (s.type === "run") {
    const d = s.run_details;
    if (!d) return null;
    const parts = [
      d.target_distance_km != null ? formatKm(d.target_distance_km) : null,
      d.target_pace_sec_per_km != null ? formatPace(d.target_pace_sec_per_km) : null,
      d.target_duration_sec != null ? formatSeconds(d.target_duration_sec) : null,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  return s.routines?.name ? `Routine: ${s.routines.name}` : null;
}

export function runActualSummary(s: SessionRow): string | null {
  const d = s.run_details;
  if (!d || d.actual_distance_km == null) return null;
  return [formatKm(d.actual_distance_km), formatPace(d.actual_pace_sec_per_km), formatSeconds(d.actual_duration_sec)].join(" · ");
}

export function liftActualSummary(a: { exercises: number; workingSets: number; volume: number } | undefined): string | null {
  if (!a) return null;
  return `${a.exercises} ex · ${a.workingSets} sets · ${a.volume.toLocaleString()} lb`;
}
