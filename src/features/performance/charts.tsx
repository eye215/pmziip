"use client";
/**
 * Small single-series SVG charts (no library). Follows the dataviz rules used
 * in this repo: one series per chart (no dual axis, no legend box — the title
 * names it), 2px line / ≤24px columns with 4px rounded data-ends, hairline
 * recessive grid, selective labels (latest value only), hover/focus values via
 * <title>, and a missing value is a gap — never drawn as 0.
 */
export type ChartPoint = { label: string; value: number | null; note?: string };

const W = 520;
const H = 240;
const PAD = { top: 22, right: 58, bottom: 34, left: 58 };

function niceMax(max: number) {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow * 4 >= max) ?? 10;
  return step * pow * 4;
}
function ticks(max: number) {
  return [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
}
/** Clean axis numbers: compact above 10,000. */
function axisText(v: number, format: (v: number) => string, percent: boolean) {
  if (percent) return format(v);
  if (v >= 10000)
    return new Intl.NumberFormat("ko-KR", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(v);
}

function Frame({
  title,
  max,
  format,
  percent,
  labels,
  children,
}: {
  title: string;
  max: number;
  format: (v: number) => string;
  percent: boolean;
  labels: { x: number; text: string }[];
  children: React.ReactNode;
}) {
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
    >
      {ticks(max).map((t) => (
        <g key={t}>
          <line
            className="chart-grid"
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(t)}
            y2={y(t)}
          />
          <text
            className="chart-axis"
            x={PAD.left - 8}
            y={y(t) + 4}
            textAnchor="end"
          >
            {axisText(t, format, percent)}
          </text>
        </g>
      ))}
      {labels.map((l, i) => (
        <text
          key={i}
          className="chart-axis"
          x={l.x}
          y={H - 10}
          textAnchor="middle"
        >
          {l.text}
        </text>
      ))}
      {children}
    </svg>
  );
}

/** Every n-th x label so they never collide (always keep the last). */
function sparseLabels(
  points: ChartPoint[],
  x: (i: number) => number,
  short: (l: string) => string,
) {
  const every = Math.max(1, Math.ceil(points.length / 5));
  return points
    .map((p, i) => ({ i, text: short(p.label) }))
    .filter(({ i }) => i % every === 0 || i === points.length - 1)
    .filter(
      ({ i }, k, arr) => !(k === arr.length - 2 && arr[k + 1].i - i < every),
    )
    .map(({ i, text }) => ({ x: x(i), text }));
}

export function LineChart({
  title,
  points,
  format,
  percent = false,
  short = (l) => l,
}: {
  title: string;
  points: ChartPoint[];
  format: (v: number) => string;
  percent?: boolean;
  short?: (label: string) => string;
}) {
  const values = points
    .map((p) => p.value)
    .filter((v): v is number => v !== null);
  const max = niceMax(Math.max(...values, 0));
  const x = (i: number) =>
    points.length === 1
      ? (PAD.left + W - PAD.right) / 2
      : PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  // Break the line at missing values.
  const segments: string[] = [];
  let current = "";
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
  });
  if (current) segments.push(current);
  const lastIndex = points.map((p) => p.value !== null).lastIndexOf(true);
  return (
    <Frame
      title={title}
      max={max}
      format={format}
      percent={percent}
      labels={sparseLabels(points, x, short)}
    >
      {segments.map((d, i) => (
        <path key={i} className="chart-line" d={d} />
      ))}
      {points.map((p, i) =>
        p.value === null ? null : (
          <g key={i} className="chart-hit" tabIndex={0}>
            <title>{`${p.label}: ${format(p.value)}${p.note ? ` · ${p.note}` : ""}`}</title>
            <circle
              className="chart-hit-area"
              cx={x(i)}
              cy={y(p.value)}
              r={14}
            />
            <circle className="chart-dot" cx={x(i)} cy={y(p.value)} r={4.5} />
          </g>
        ),
      )}
      {lastIndex >= 0 && (
        <text
          className="chart-value"
          x={x(lastIndex) + 10}
          y={y(points[lastIndex].value!) + 4}
        >
          {format(points[lastIndex].value!)}
        </text>
      )}
    </Frame>
  );
}

export function ColumnChart({
  title,
  points,
  format,
  short = (l) => l,
}: {
  title: string;
  points: ChartPoint[];
  format: (v: number) => string;
  short?: (label: string) => string;
}) {
  const values = points
    .map((p) => p.value)
    .filter((v): v is number => v !== null);
  const max = niceMax(Math.max(...values, 0));
  const band = (W - PAD.left - PAD.right) / Math.max(points.length, 1);
  const bw = Math.min(24, band * 0.6);
  const x = (i: number) => PAD.left + band * (i + 0.5);
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const base = y(0);
  const lastIndex = points.map((p) => p.value !== null).lastIndexOf(true);
  return (
    <Frame
      title={title}
      max={max}
      format={format}
      percent={false}
      labels={sparseLabels(points, x, short)}
    >
      {points.map((p, i) => {
        if (p.value === null || p.value <= 0)
          return (
            <g key={i} className="chart-hit" tabIndex={0}>
              <title>{`${p.label}: ${p.value === null ? "미집계" : format(p.value)}`}</title>
              <rect
                className="chart-hit-area"
                x={x(i) - band / 2}
                y={PAD.top}
                width={band}
                height={base - PAD.top}
              />
            </g>
          );
        const top = y(p.value);
        const r = Math.min(4, (base - top) / 2);
        const l = x(i) - bw / 2;
        // Rounded data-end (top), square at the baseline.
        const d = `M${l},${base}V${top + r}Q${l},${top} ${l + r},${top}H${l + bw - r}Q${l + bw},${top} ${l + bw},${top + r}V${base}Z`;
        return (
          <g key={i} className="chart-hit" tabIndex={0}>
            <title>{`${p.label}: ${format(p.value)}${p.note ? ` · ${p.note}` : ""}`}</title>
            <rect
              className="chart-hit-area"
              x={x(i) - band / 2}
              y={PAD.top}
              width={band}
              height={base - PAD.top}
            />
            <path
              className={
                i === lastIndex ? "chart-col chart-col-latest" : "chart-col"
              }
              d={d}
            />
          </g>
        );
      })}
      {lastIndex >= 0 && points[lastIndex].value! > 0 && (
        <text
          className="chart-value"
          x={x(lastIndex)}
          y={y(points[lastIndex].value!) - 6}
          textAnchor="middle"
        >
          {format(points[lastIndex].value!)}
        </text>
      )}
    </Frame>
  );
}

/** Inline magnitude bar for tables (0–100%). */
export function InlineBar({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <span className="inline-bar" aria-hidden="true">
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}
