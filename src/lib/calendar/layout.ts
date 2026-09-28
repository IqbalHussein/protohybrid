import { addDays } from "@/lib/week";

/**
 * Geometry for the week grid. Free of React and of the database so the
 * placement rules can be tested directly — the same split the logger's charts
 * use between `chart.ts` and `LineChart`.
 *
 * Every vertical coordinate here is minutes since local midnight. Converting
 * an instant into that number is `minutesIntoDay` in `src/lib/time.ts`, which
 * is the only place the app's zone is applied.
 */

export type Span = { startMin: number; endMin: number };

/** Where a span lands in the grid, as percentages of the column's height. */
export type Placement = { topPct: number; heightPct: number };

/** A span clipped to one calendar day, which is what a column can draw. */
export type DaySegment = Span & {
  date: string;
  /** False when the span continues past this day's edges, so the card can say so. */
  startsHere: boolean;
  endsHere: boolean;
};

export const MINUTES_IN_DAY = 24 * 60;

/** The window the grid shows when nothing forces it wider: 6am to 10pm. */
export const DEFAULT_WINDOW_START = 6 * 60;
export const DEFAULT_WINDOW_END = 22 * 60;

/** Drag drops land on quarter hours; finer resolution is noise on a week view. */
export const SNAP_MINUTES = 15;

/** Cards shorter than this get a legible height even if the session is 20 minutes. */
const MIN_HEIGHT_PCT = 3;

/**
 * The visible time window: the default, widened to whole hours around anything
 * that would otherwise be cut off.
 *
 * A 5am run has to be on the grid, and clipping it would be a silent lie about
 * the week. Expanding is preferred over scrolling because the whole point of
 * the screen is seeing the week at once.
 */
export function gridWindow(spans: Span[]): Span {
  let start = DEFAULT_WINDOW_START;
  let end = DEFAULT_WINDOW_END;

  for (const s of spans) {
    start = Math.min(start, floorHour(s.startMin));
    end = Math.max(end, ceilHour(s.endMin));
  }

  return { startMin: clampToDay(start), endMin: clampToDay(end) };
}

/** Whole hours inside a window, for the row lines and the time gutter. */
export function hourMarks(window: Span): number[] {
  const marks: number[] = [];
  for (let m = ceilHour(window.startMin); m < window.endMin; m += 60) marks.push(m);
  return marks;
}

export function placeSpan(span: Span, window: Span): Placement {
  const total = window.endMin - window.startMin;
  if (total <= 0) return { topPct: 0, heightPct: 100 };

  // Clip rather than overflow: a span can start before the window when the
  // window was pinned by something else.
  const top = Math.max(span.startMin, window.startMin);
  const bottom = Math.min(span.endMin, window.endMin);

  const topPct = ((top - window.startMin) / total) * 100;
  const heightPct = Math.max(MIN_HEIGHT_PCT, ((bottom - top) / total) * 100);

  return {
    topPct: Math.max(0, Math.min(100 - MIN_HEIGHT_PCT, topPct)),
    heightPct: Math.min(heightPct, 100 - Math.max(0, topPct)),
  };
}

/** The minute a pointer at `fraction` down a column is over, snapped. */
export function minuteAt(fraction: number, window: Span, snap = SNAP_MINUTES): number {
  const total = window.endMin - window.startMin;
  const raw = window.startMin + Math.max(0, Math.min(1, fraction)) * total;
  const snapped = Math.round(raw / snap) * snap;
  return Math.max(0, Math.min(MINUTES_IN_DAY - snap, snapped));
}

/**
 * Clip a span that may cross midnight into one segment per day it touches.
 *
 * A work shift that runs 10pm to 6am is one `busy_blocks` row but two things
 * to draw, and a grid that placed it only on its start day would leave the
 * next morning looking free. Segments outside the requested days are dropped.
 */
export function splitAcrossDays(
  startDate: string,
  startMin: number,
  endDate: string,
  endMin: number,
  days: string[],
): DaySegment[] {
  const segments: DaySegment[] = [];

  // Start at the first visible day: a block that began weeks ago still covers
  // this one, and walking from its real start would hit the guard first.
  const first = days.length && startDate < days[0] ? days[0] : startDate;

  for (let date = first, guard = 0; date <= endDate && guard < 14; date = addDays(date, 1), guard += 1) {
    const isFirst = date === startDate;
    const isLast = date === endDate;

    const from = isFirst ? startMin : 0;
    const to = isLast ? endMin : MINUTES_IN_DAY;

    // A block ending exactly at midnight names the next day but occupies none
    // of it; drawing a zero-height sliver there would be noise.
    if (to <= from) continue;
    if (!days.includes(date)) continue;

    segments.push({ date, startMin: from, endMin: to, startsHere: isFirst, endsHere: isLast });
  }

  return segments;
}

/**
 * Side-by-side lanes for overlapping items in one column.
 *
 * Two sessions at the same hour is a real thing to plan (and something the
 * conflict rules will later want to flag), so they share the column's width
 * rather than one hiding the other. Greedy left-to-right packing: each item
 * takes the first lane whose last occupant has finished.
 */
export function assignLanes<T extends Span>(items: T[]): (T & { lane: number; lanes: number })[] {
  const ordered = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const laneEnds: number[] = [];
  const placed = ordered.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.endMin;
    return { ...item, lane, lanes: 1 };
  });

  // One lane count for the whole column keeps card widths consistent down the
  // day instead of jumping per cluster.
  const lanes = Math.max(1, laneEnds.length);
  return placed.map((p) => ({ ...p, lanes }));
}

function floorHour(minutes: number): number {
  return Math.floor(minutes / 60) * 60;
}

function ceilHour(minutes: number): number {
  return Math.ceil(minutes / 60) * 60;
}

function clampToDay(minutes: number): number {
  return Math.max(0, Math.min(MINUTES_IN_DAY, minutes));
}
