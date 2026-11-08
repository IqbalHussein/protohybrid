import type { SessionStatus, SessionType } from "@/lib/types";

// The app-wide visual grammar for sessions:
//   planned   = hollow outline in the discipline colour
//   completed = solid fill in the discipline colour (black text)
//   skipped   = dim, struck through
// Use these for every session card/chip so week, lifts and runs read the same.
export function sessionToneClasses(type: SessionType, status: SessionStatus): string {
  if (status === "skipped") return "border border-dashed border-ink-line-strong text-chalk-faint line-through";
  if (status === "completed") return type === "run" ? "bg-run text-ink" : "bg-lift text-ink";
  return type === "run" ? "border-2 border-run text-chalk" : "border-2 border-lift text-chalk";
}

// Accent text colour for a discipline (headings, numbers).
export function disciplineText(type: SessionType): string {
  return type === "run" ? "text-run" : "text-lift";
}

export function disciplineLabel(type: SessionType): string {
  return type === "run" ? "Run" : "Lift";
}
