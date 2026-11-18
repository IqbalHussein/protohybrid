import type { WeekKind } from "@/lib/planner";
import { focusLabel } from "@/lib/lifts";
import { runTypeLabel } from "@/lib/runs";
import { formatDateLabel } from "@/lib/time";
import type { PlanSessionView } from "./data";

// Plain-text labels so colour is never the only signal.

export const INTENSITY_LABEL = { easy: "Easy", moderate: "Moderate", hard: "Hard" } as const;

export const WEEK_KIND_LABEL: Record<WeekKind, string> = {
  build: "Build",
  deload: "Deload",
  race: "Race",
  recovery: "Recovery",
};

export function sessionTitle(s: Pick<PlanSessionView, "type" | "runType" | "liftFocus">): string {
  if (s.type === "run") return `${runTypeLabel(s.runType ?? "easy")} run`;
  return `${focusLabel(s.liftFocus?.trim() || "full-body")} lift`;
}

// "Run · Tempo · 45m" / "Lift · Upper · 60m"
export function chipText(s: Pick<PlanSessionView, "type" | "runType" | "liftFocus" | "durationMin">): string {
  const kind = s.type === "run" ? "Run" : "Lift";
  const sub = s.type === "run" ? runTypeLabel(s.runType ?? "easy") : focusLabel(s.liftFocus?.trim() || "full-body");
  return `${kind} · ${sub} · ${s.durationMin}m`;
}

export function slotLabel(slot: PlanSessionView["slot"]): string | null {
  return slot === "am" ? "AM" : slot === "pm" ? "PM" : null;
}

const SLOT_ORDER = { am: 0, pm: 1 } as const;
export function bySlot(a: PlanSessionView, b: PlanSessionView): number {
  return (a.slot ? SLOT_ORDER[a.slot] : 2) - (b.slot ? SLOT_ORDER[b.slot] : 2);
}

export const STATUS_LABEL = { planned: "Planned", completed: "Done", skipped: "Skipped", preview: "Preview" } as const;

// "Tue 18 Nov · PM Tempo run · 45m"
export function sessionOptionLabel(s: PlanSessionView): string {
  const slot = slotLabel(s.slot);
  return `${formatDateLabel(s.date)} · ${slot ? `${slot} ` : ""}${sessionTitle(s)} · ${s.durationMin}m`;
}
