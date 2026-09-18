import type { SessionStatus, SessionType } from "@/lib/types";

export type RunType = "easy" | "tempo" | "long" | "interval" | "race";

export type RunDetails = {
  run_type: RunType;
  target_distance_km: number | null;
  target_pace_sec_per_km: number | null;
  target_duration_sec: number | null;
  actual_distance_km: number | null;
  actual_pace_sec_per_km: number | null;
  actual_duration_sec: number | null;
  strava_activity_id: string | null;
};

export type LiftDetails = {
  focus: string;
  notes: string | null;
  started_at: string | null;
  completed_at: string | null;
};

/** One session as the grid needs it: the row, its type-specific details, and its place in the day. */
export type CalendarSession = {
  id: string;
  type: SessionType;
  status: SessionStatus;
  plannedDate: string;
  /** Minutes since midnight, or null for an "anytime that day" session. */
  startMin: number | null;
  durationMin: number | null;
  routineId: string | null;
  run: RunDetails | null;
  lift: LiftDetails | null;
};

export type BusyBlock = {
  id: string;
  title: string;
  /** ISO instants; the grid converts them through the app's zone. */
  startTime: string;
  endTime: string;
  source: "manual" | "google_calendar";
};

export type Week = {
  weekStart: string;
  dates: string[];
  sessions: CalendarSession[];
  busyBlocks: BusyBlock[];
};

export const RUN_TYPES: RunType[] = ["easy", "tempo", "long", "interval", "race"];

export const RUN_TYPE_LABELS: Record<RunType, string> = {
  easy: "Easy",
  tempo: "Tempo",
  long: "Long",
  interval: "Interval",
  race: "Race",
};

/**
 * How long a session occupies the grid when no duration was planned.
 *
 * A timed session with no duration still has to be drawn as something. An hour
 * is the honest default for both disciplines, and it is drawn dashed so it
 * never reads as a committed length.
 */
export const ASSUMED_DURATION_MIN = 60;
