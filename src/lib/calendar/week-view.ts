import { minutesIntoDay, zonedDateString } from "@/lib/time";
import { formatDayHeading, isPast, isToday } from "@/lib/week";
import type { SessionStatus, SessionType } from "@/lib/types";
import { conflictsFor, type Conflict } from "./conflicts";
import {
  assignLanes,
  gridWindow,
  hourMarks,
  placeSpan,
  splitAcrossDays,
  type Placement,
  type Span,
} from "./layout";
import { formatDistance, formatPace, formatRunDuration } from "./runs";
import { ASSUMED_DURATION_MIN, RUN_TYPE_LABELS, type BusyBlock, type CalendarSession, type Week } from "./types";

/**
 * Everything the grid draws, resolved on the server: local wall-clock
 * positions, lane assignments, card text and the conflict surface.
 *
 * The grid component is a client component so cards can be dragged, which
 * means it cannot query or reach for the app's zone — so nothing is left for
 * it to compute. This also keeps the placement rules in a module that can be
 * tested without rendering anything.
 */

export type SessionView = {
  id: string;
  type: SessionType;
  status: SessionStatus;
  title: string;
  subtitle: string | null;
  /** Null for an "anytime that day" session, which is pinned above the timed cards. */
  startMin: number | null;
  durationMin: number | null;
  /** True when the card's height is the fallback hour, not a planned duration. */
  assumedDuration: boolean;
  /** Set when a lift session can be opened in the logger. */
  startable: boolean;
  /** A planned session whose day has gone by, and which was never resolved. */
  unresolved: boolean;
  conflicts: string[];
};

export type PlacedSession = SessionView & Placement & { lane: number; lanes: number };

export type BusyView = Placement & {
  id: string;
  title: string;
  label: string;
  source: BusyBlock["source"];
  /** False when the block continues past this column, so the card can say so. */
  startsHere: boolean;
  endsHere: boolean;
};

export type DayView = {
  date: string;
  heading: string;
  isToday: boolean;
  isPast: boolean;
  untimed: SessionView[];
  timed: PlacedSession[];
  busy: BusyView[];
};

export type WeekView = {
  weekStart: string;
  window: Span;
  hourMarks: number[];
  days: DayView[];
  /** The week-level conflict summary, one line per conflict touching this week. */
  warnings: string[];
};

export function buildWeekView(
  week: Week,
  options: { setCounts?: Map<string, number>; now?: Date; conflicts?: Conflict[] } = {},
): WeekView {
  const now = options.now ?? new Date();
  const setCounts = options.setCounts ?? new Map<string, number>();

  // Conflicts are found over a window wider than the week (a rest-day streak
  // can start the week before), so only the ones touching a session drawn
  // here belong on this page.
  const inWeek = new Set(week.sessions.map((s) => s.id));
  const conflicts = (options.conflicts ?? []).filter((c) => c.sessionIds.some((id) => inWeek.has(id)));

  // Busy blocks are instants; convert once, here, and clip anything crossing
  // midnight into per-day pieces so a night shift darkens both mornings.
  const segments = week.busyBlocks.flatMap((block) => {
    const start = new Date(block.startTime);
    const end = new Date(block.endTime);
    return splitAcrossDays(
      zonedDateString(start),
      minutesIntoDay(start),
      zonedDateString(end),
      minutesIntoDay(end),
      week.dates,
    ).map((segment) => ({ block, segment }));
  });

  const timedSessions = week.sessions
    .filter((s) => s.startMin != null)
    .map((s) => ({ session: s, span: sessionSpan(s) }));

  // One window for the whole week so every column shares a vertical scale.
  const window = gridWindow([...timedSessions.map((t) => t.span), ...segments.map((s) => s.segment)]);

  const days: DayView[] = week.dates.map((date) => {
    const daySessions = week.sessions.filter((s) => s.plannedDate === date);

    const untimed = daySessions
      .filter((s) => s.startMin == null)
      .map((s) => toView(s, setCounts, conflicts, now));

    const placed = assignLanes(
      daySessions
        .filter((s) => s.startMin != null)
        .map((s) => ({ ...sessionSpan(s), session: s })),
    );

    return {
      date,
      heading: formatDayHeading(date),
      isToday: isToday(date, now),
      isPast: isPast(date, now),
      untimed,
      timed: placed.map(({ session, lane, lanes, ...span }) => ({
        ...toView(session, setCounts, conflicts, now),
        ...placeSpan(span, window),
        lane,
        lanes,
      })),
      busy: segments
        .filter(({ segment }) => segment.date === date)
        .map(({ block, segment }) => ({
          id: block.id,
          title: block.title,
          label: busyLabel(block, segment.startsHere, segment.endsHere),
          source: block.source,
          startsHere: segment.startsHere,
          endsHere: segment.endsHere,
          ...placeSpan(segment, window),
        })),
    };
  });

  return {
    weekStart: week.weekStart,
    window,
    hourMarks: hourMarks(window),
    days,
    warnings: [...new Set(conflicts.map((c) => c.message))],
  };
}

/** A timed session's span, falling back to an hour when no duration was planned. */
function sessionSpan(session: CalendarSession): Span {
  const startMin = session.startMin ?? 0;
  return { startMin, endMin: startMin + (session.durationMin ?? ASSUMED_DURATION_MIN) };
}

function toView(
  session: CalendarSession,
  setCounts: Map<string, number>,
  conflicts: Conflict[],
  now: Date,
): SessionView {
  return {
    id: session.id,
    type: session.type,
    status: session.status,
    title: sessionTitle(session),
    subtitle: sessionSubtitle(session, setCounts),
    startMin: session.startMin,
    durationMin: session.durationMin,
    assumedDuration: session.startMin != null && session.durationMin == null,
    startable: session.type === "lift" && session.status !== "completed",
    // A planned session whose date has passed is left standing rather than
    // auto-skipped, so the week reads honestly instead of tidying itself up.
    unresolved: session.status === "planned" && isPast(session.plannedDate, now),
    conflicts: conflictsFor(conflicts, session.id).map((c) => c.message),
  };
}

function sessionTitle(session: CalendarSession): string {
  if (session.type === "run") {
    const type = session.run?.run_type;
    return type ? `${RUN_TYPE_LABELS[type]} run` : "Run";
  }
  return session.lift?.focus ?? "Lift";
}

/** The one line under a card's title: what happened if it did, what's planned if it hasn't. */
function sessionSubtitle(session: CalendarSession, setCounts: Map<string, number>): string | null {
  if (session.type === "run") {
    const run = session.run;
    if (!run) return null;

    if (session.status === "completed") {
      const actual = [
        formatDistance(run.actual_distance_km),
        formatRunDuration(run.actual_duration_sec),
        formatPace(run.actual_pace_sec_per_km),
      ].filter(Boolean);
      return actual.length ? actual.join(" · ") : "Completed";
    }

    const target = [
      formatDistance(run.target_distance_km),
      formatRunDuration(run.target_duration_sec),
      formatPace(run.target_pace_sec_per_km),
    ].filter(Boolean);
    return target.length ? target.join(" · ") : null;
  }

  const sets = setCounts.get(session.id);
  if (sets) return `${sets} ${sets === 1 ? "set" : "sets"} logged`;
  if (session.lift?.started_at && !session.lift.completed_at) return "In progress";
  return session.routineId ? "From a routine" : null;
}

function busyLabel(block: BusyBlock, startsHere: boolean, endsHere: boolean): string {
  if (startsHere && endsHere) return block.title;
  // A clipped segment says which edge it runs past, so a night shift doesn't
  // look like two unrelated commitments.
  return startsHere ? `${block.title} →` : `→ ${block.title}`;
}
