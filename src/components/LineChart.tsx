// Minimal dependency-free SVG line chart for the progress views. Server
// rendered; scales to its container's width.

export type ChartPoint = { label: string; value: number };

export function LineChart({
  points,
  unit = "",
  height = 160,
  title,
}: {
  points: ChartPoint[];
  unit?: string;
  height?: number;
  title: string;
}) {
  if (points.length === 0) {
    return <p className="text-sm text-neutral-500">No data yet.</p>;
  }

  const W = 600;
  const H = height;
  const pad = { top: 12, right: 12, bottom: 22, left: 44 };
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min = min * 0.9;
    max = max * 1.1 || 1;
  }
  const x = (i: number) =>
    pad.left + (points.length === 1 ? (W - pad.left - pad.right) / 2 : (i / (points.length - 1)) * (W - pad.left - pad.right));
  const y = (v: number) => pad.top + (1 - (v - min) / (max - min)) * (H - pad.top - pad.bottom);
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v * 10) / 10));
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const ticks = [min, (min + max) / 2, max];
  const last = points[points.length - 1];

  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-neutral-500">
          Latest: {fmt(last.value)}
          {unit} · Best: {fmt(Math.max(...values))}
          {unit}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className="stroke-neutral-200" strokeWidth={1} />
            <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" className="fill-neutral-400" fontSize={11}>
              {fmt(t)}
            </text>
          </g>
        ))}
        <text x={pad.left} y={H - 6} className="fill-neutral-400" fontSize={11}>
          {points[0].label}
        </text>
        {points.length > 1 ? (
          <text x={W - pad.right} y={H - 6} textAnchor="end" className="fill-neutral-400" fontSize={11}>
            {last.label}
          </text>
        ) : null}
        <path d={path} fill="none" className="stroke-neutral-900" strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={3} className="fill-neutral-900">
            <title>
              {p.label}: {fmt(p.value)}
              {unit}
            </title>
          </circle>
        ))}
      </svg>
    </figure>
  );
}
