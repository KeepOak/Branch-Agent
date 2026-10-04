import { useState } from "react";
import type { ChartSpec } from "./artifact-preview";
import { ArtifactPictureButton } from "./ArtifactPictureButton";

const colour = (index: number) => `var(--series-${index % 8 + 1}, var(--ink))`;
function domain(chart: ChartSpec) {
  const magnitude = chart.points.reduce((max, p) => Math.max(max, Math.abs(p.value)), 0) || 1;
  const min = chart.points.reduce((low, p) => Math.min(low, p.value / magnitude), 0);
  const max = chart.points.reduce((high, p) => Math.max(high, p.value / magnitude), 0);
  return { magnitude, min, max };
}

/** Horizontal bars follow the approved reply card and retain negative/zero values. */
function Bars({ chart }: { chart: ChartSpec }) {
  const { min, max, magnitude } = domain(chart);
  const x = (value: number) => 110 + (value / magnitude - min) / (max - min || 1) * 340;
  const lowest = chart.points.reduce((low, p) => Math.min(low, p.value), Infinity);
  return <svg viewBox={`0 0 560 ${chart.points.length * 30 + 20}`} role="img" aria-label={chart.title}>
    {chart.points.map((point, i) => <g key={i} tabIndex={0} aria-label={`${point.label}: ${point.value}`} data-reading={`${point.label}: ${point.value}`}>
      <title>{point.label}: {point.value}</title>
      <text x="100" y={i * 30 + 21} textAnchor="end">{point.label}</text>
      <rect x={Math.min(x(0), x(point.value))} y={i * 30 + 8} width={Math.max(1, Math.abs(x(point.value) - x(0)))} height="18" rx="4" fill={point.value === lowest ? "var(--ink)" : "var(--line-2, var(--line))"} />
      <text x={x(point.value) + 6} y={i * 30 + 21}>{point.value}</text>
    </g>)}
  </svg>;
}

function Line({ chart }: { chart: ChartSpec }) {
  const { min, max, magnitude } = domain(chart);
  const x = (i: number) => 30 + i / Math.max(1, chart.points.length - 1) * 500;
  const y = (value: number) => 250 - (value / magnitude - min) / (max - min || 1) * 220;
  return <svg viewBox="0 0 560 280" role="img" aria-label={chart.title}>
    <polyline points={chart.points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} fill="none" stroke={colour(0)} strokeWidth="2" />
    {chart.points.map((p, i) => <g key={i} tabIndex={0} aria-label={`${p.label}: ${p.value}`} data-reading={`${p.label}: ${p.value}`}><circle cx={x(i)} cy={y(p.value)} r="5" fill={colour(0)}><title>{p.label}: {p.value}</title></circle><text x={x(i)} y="273" textAnchor="middle">{p.label}</text></g>)}
  </svg>;
}

function Pie({ chart }: { chart: ChartSpec }) {
  const { magnitude } = domain(chart);
  const total = chart.points.reduce((sum, p) => sum + Math.abs(p.value) / magnitude, 0);
  let start = -Math.PI / 2;
  return <svg viewBox="0 0 560 280" role="img" aria-label={chart.title}>
    {chart.points.map((p, i) => {
      const sweep = total ? Math.abs(p.value) / magnitude / total * Math.PI * 2 : 0, end = start + sweep;
      const path = `M280 140 L${280 + 120 * Math.cos(start)} ${140 + 120 * Math.sin(start)} A120 120 0 ${sweep > Math.PI ? 1 : 0} 1 ${280 + 120 * Math.cos(end)} ${140 + 120 * Math.sin(end)} Z`;
      start = end;
      const reading = `${p.label}: ${p.value}`;
      return <g key={i} tabIndex={0} aria-label={reading} data-reading={reading}><title>{reading}</title>{sweep >= Math.PI * 2 ? <circle cx="280" cy="140" r="120" fill={colour(i)} />
        : <path d={path} fill={colour(i)} />}</g>;
    })}
  </svg>;
}

export function ArtifactChart({ chart }: { chart: ChartSpec }) {
  const [reading, setReading] = useState("");
  const read = (target: EventTarget) => { if (target instanceof Element) setReading(target.closest("[data-reading]")?.getAttribute("data-reading") ?? ""); };
  return <div className="artifact-chart" onPointerOver={event => read(event.target)} onFocusCapture={event => read(event.target)}>{chart.type === "bar" ? <Bars chart={chart} /> : chart.type === "line" ? <Line chart={chart} /> : <Pie chart={chart} />}
    <p className="artifact-preview-note" role="status">{reading}</p>
    <details><summary>Show the numbers</summary><table><thead><tr><th>Label</th><th>Value</th></tr></thead><tbody>{chart.points.map((p, i) => <tr key={i}><td>{p.label}</td><td>{p.value}</td></tr>)}</tbody></table></details>
    <ArtifactPictureButton key={JSON.stringify(chart)} title={chart.title} />
  </div>;
}
