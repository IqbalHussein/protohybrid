/**
 * Geometry for the progress line charts. Kept free of React and of any DOM so
 * the scaling rules can be tested directly; `LineChart` only renders what this
 * returns.
 */

export type ChartDatum = {
  /** ISO date (YYYY-MM-DD) — the x value. */
  date: string;
  value: number;
};

export type PlottedPoint = ChartDatum & {
  cx: number;
  cy: number;
};

export type LinePlot = {
  width: number;
  height: number;
  /** SVG path for the line, or "" when there is nothing to join. */
  path: string;
  points: PlottedPoint[];
  /** Value at the bottom and top of the y-axis, for the axis labels. */
  yMin: number;
  yMax: number;
  /** Plot-area edges, so the renderer can draw the baseline and grid. */
  plot: { left: number; right: number; top: number; bottom: number };
};

const PADDING = { top: 8, right: 8, bottom: 18, left: 38 };

/**
 * Pick the y-axis range.
 *
 * A zero baseline is the honest default for magnitudes, but strength series
 * live in a narrow band — 185 to 195 lb over three months is a real
 * progression that a 0-based axis renders as a flat line. So the axis fits the
 * data with 10% headroom instead, and the renderer always prints the min and
 * max values on the axis so a truncated baseline can't be misread as growth
 * from nothing.
 */
export function yDomain(values: number[]): { min: number; max: number } {
  if (!values.length) return { min: 0, max: 1 };

  const lo = Math.min(...values);
  const hi = Math.max(...values);

  // A flat series still needs a non-zero span or every point lands on one row.
  if (lo === hi) {
    const pad = Math.abs(hi) * 0.1 || 1;
    return { min: Math.max(0, lo - pad), max: hi + pad };
  }

  const pad = (hi - lo) * 0.1;
  return { min: Math.max(0, lo - pad), max: hi + pad };
}

export function linePlot(data: ChartDatum[], width = 320, height = 120): LinePlot {
  const plot = {
    left: PADDING.left,
    right: width - PADDING.right,
    top: PADDING.top,
    bottom: height - PADDING.bottom,
  };

  const { min: yMin, max: yMax } = yDomain(data.map((d) => d.value));
  const span = yMax - yMin;
  const innerWidth = plot.right - plot.left;
  const innerHeight = plot.bottom - plot.top;

  const points: PlottedPoint[] = data.map((d, i) => ({
    ...d,
    // A lone point sits mid-plot rather than pinned to the left edge.
    cx: data.length === 1 ? plot.left + innerWidth / 2 : plot.left + (i / (data.length - 1)) * innerWidth,
    cy: plot.bottom - ((d.value - yMin) / span) * innerHeight,
  }));

  const path =
    points.length < 2
      ? ""
      : points.map((p, i) => `${i === 0 ? "M" : "L"}${round(p.cx)} ${round(p.cy)}`).join(" ");

  return { width, height, path, points, yMin, yMax, plot };
}

/** Two decimals is well past sub-pixel; it just keeps the path string short. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
