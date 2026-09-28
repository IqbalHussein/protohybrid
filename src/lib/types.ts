/** Enum values shared by the whole app, mirroring the types created in 0001. */

export type SessionType = "run" | "lift";

export type SessionStatus = "planned" | "completed" | "skipped";

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  planned: "Planned",
  completed: "Completed",
  skipped: "Skipped",
};
