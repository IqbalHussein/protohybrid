"use client";

import { useRef, useState } from "react";
import { linePlot, type ChartDatum } from "@/lib/lift/chart";
import { roundTo } from "@/lib/lift/math";

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 120;

// Single series, so no legend — the heading names it. Slot-1 blue, which
// clears 3:1 against the white chart surface this app uses.
const SERIES = "#2a78d6";

type Props = {
  title: string;
  data: ChartDatum[];
  /** Appended to values in the tooltip and axis labels, e.g. "lb". */
  unit?: string;
  /** Shown instead of the chart when there is nothing to plot. */
  emptyMessage?: string;
};

/**
 * A one-series progress line with a crosshair tooltip. Session counts are
 * small (tens of points), so every point gets a marker and a hit target
 * rather than being sampled.
 */
export default function LineChart({ title, data, unit = "", emptyMessage }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const plot = linePlot(data, VIEW_WIDTH, VIEW_HEIGHT);
  const active = activeIndex == null ? null : plot.points[activeIndex];
  const label = (v: number) => `${roundTo(v).toLocaleString()}${unit ? ` ${unit}` : ""}`;

  // Pointer x is in CSS pixels; the chart is drawn in viewBox units and scales
  // with the container, so convert before looking for the nearest point.
  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !plot.points.length) return;
    const x = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH;

    let nearest = 0;
    for (let i = 1; i < plot.points.length; i += 1) {
      if (Math.abs(plot.points[i].cx - x) < Math.abs(plot.points[nearest].cx - x)) nearest = i;
    }
    setActiveIndex(nearest);
  }

  if (!data.length) {
    return (
      <figure className="flex flex-col gap-1">
        <figcaption className="text-sm font-medium">{title}</figcaption>
        <p className="py-6 text-center text-sm text-neutral-500">
          {emptyMessage ?? "Not enough history yet."}
        </p>
      </figure>
    );
  }

  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs tabular-nums text-neutral-500">
          {active ? `${active.date} · ${label(active.value)}` : label(data[data.length - 1].value)}
        </span>
      </figcaption>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="h-auto w-full touch-none"
        role="img"
        aria-label={`${title}. ${data.length} sessions, from ${label(data[0].value)} on ${data[0].date} to ${label(data[data.length - 1].value)} on ${data[data.length - 1].date}.`}
        onPointerMove={handleMove}
        onPointerLeave={() => setActiveIndex(null)}
      >
        {/* Recessive axis: only the two values that bound the plot, so a
            non-zero baseline is always visible as a number. */}
        <text x={4} y={plot.plot.top + 4} className="fill-neutral-400 text-[8px]">
          {roundTo(plot.yMax).toLocaleString()}
        </text>
        <text x={4} y={plot.plot.bottom} className="fill-neutral-400 text-[8px]">
          {roundTo(plot.yMin).toLocaleString()}
        </text>
        <line
          x1={plot.plot.left}
          y1={plot.plot.bottom}
          x2={plot.plot.right}
          y2={plot.plot.bottom}
          stroke="currentColor"
          className="text-neutral-200"
        />

        {plot.path ? (
          <path d={plot.path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        ) : null}

        {active ? (
          <line
            x1={active.cx}
            y1={plot.plot.top}
            x2={active.cx}
            y2={plot.plot.bottom}
            stroke="currentColor"
            className="text-neutral-300"
            strokeDasharray="2 2"
          />
        ) : null}

        {plot.points.map((p, i) => (
          <circle
            key={`${p.date}-${i}`}
            cx={p.cx}
            cy={p.cy}
            r={activeIndex === i ? 5 : 4}
            fill={SERIES}
            /* 2px surface ring keeps overlapping markers separable. */
            stroke="#ffffff"
            strokeWidth={2}
          />
        ))}

        {/* First and last dates only — one label per point collides instantly. */}
        <text x={plot.plot.left} y={VIEW_HEIGHT - 4} className="fill-neutral-400 text-[8px]">
          {data[0].date.slice(5)}
        </text>
        {data.length > 1 ? (
          <text x={plot.plot.right} y={VIEW_HEIGHT - 4} textAnchor="end" className="fill-neutral-400 text-[8px]">
            {data[data.length - 1].date.slice(5)}
          </text>
        ) : null}
      </svg>

      {/* Identity is never color-alone, and the numbers stay reachable without
          a pointer (and for screen readers). */}
      <details className="text-xs text-neutral-500">
        <summary className="cursor-pointer">Table</summary>
        <table className="mt-1 w-full text-left tabular-nums">
          <thead>
            <tr className="text-neutral-400">
              <th className="font-normal">Date</th>
              <th className="font-normal">{title}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={`${d.date}-${i}`}>
                <td>{d.date}</td>
                <td>{label(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
