import { useId } from "react";

const INK = "var(--color-ink)", GRID = "var(--color-line)", BRAND = "var(--color-brand)";
const W = 480, H = 220, M = { l: 44, r: 14, t: 12, b: 30 };
const scale = (v: number, a: number, b: number, c: number, d: number) => (b === a ? (c + d) / 2 : c + ((v - a) / (b - a)) * (d - c));
const nice = (n: number) => (n === 0 ? "0" : Math.abs(n) >= 10 ? n.toFixed(0) : n.toFixed(Math.abs(n) < 1 ? 2 : 1));

export interface Pt { x: number; y: number; label?: string }

/** Accessible line/scatter chart. A hidden table repeats every point for screen readers. */
export function LineChart({ points, xLabel, yLabel, title, xFmt = nice, diagonal = false, hatched = false, ymin, ymax, xmin, xmax }: {
  points: Pt[]; xLabel: string; yLabel: string; title: string; xFmt?: (n: number) => string; diagonal?: boolean; hatched?: boolean;
  ymin?: number; ymax?: number; xmin?: number; xmax?: number;
}) {
  const id = useId();
  if (!points.length) return null;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x0 = xmin ?? Math.min(...xs), x1 = xmax ?? Math.max(...xs);
  const lo = ymin ?? Math.min(...ys), hi = ymax ?? Math.max(...ys), pad = ymin === undefined ? (hi - lo || 1) * 0.15 : 0;
  const y0 = lo - pad, y1 = hi + pad * (ymax === undefined ? 1 : 0);
  const X = (v: number) => scale(v, x0, x1, M.l, W - M.r), Y = (v: number) => scale(v, y0, y1, H - M.b, M.t);
  const ticks = [0, 1, 2, 3].map((i) => y0 + ((y1 - y0) * i) / 3);
  const xt = points.length <= 6 ? points.map((p) => p.x) : [x0, (x0 + x1) / 2, x1];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t`} className="w-full">
        <title id={`${id}-t`}>{`${title}. ${points.length} points; y from ${nice(Math.min(...ys))} to ${nice(Math.max(...ys))}.`}</title>
        {ticks.map((t) => (<g key={t}><line x1={M.l} x2={W - M.r} y1={Y(t)} y2={Y(t)} stroke={GRID} strokeDasharray="3 4" />
          <text x={M.l - 6} y={Y(t) + 4} textAnchor="end" fontSize="10.5" fill="var(--color-ink-muted)" className="num">{nice(t)}</text></g>))}
        {xt.map((t, i) => <text key={i} x={X(t)} y={H - 12} textAnchor={i === 0 ? "start" : i === xt.length - 1 ? "end" : "middle"} fontSize="10.5" fill="var(--color-ink-muted)" className="num">{xFmt(t)}</text>)}
        {diagonal && <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke="#8a97b3" strokeDasharray="5 4" />}
        <polyline fill="none" stroke={BRAND} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={hatched ? "6 4" : undefined}
          points={points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")} />
        {points.length <= 40 && points.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r="3.5" fill="var(--color-card)" stroke={BRAND} strokeWidth="2" />)}
        <text x={W / 2} y={H - 1} textAnchor="middle" fontSize="10.5" fill={INK}>{xLabel}</text>
        <text transform={`rotate(-90 11 ${H / 2})`} x="11" y={H / 2} textAnchor="middle" fontSize="10.5" fill={INK}>{yLabel}</text>
      </svg>
      <table className="sr-only"><caption>{title}</caption><thead><tr><th>{xLabel}</th><th>{yLabel}</th></tr></thead>
        <tbody>{points.map((p, i) => <tr key={i}><td>{p.label ?? xFmt(p.x)}</td><td>{nice(p.y)}</td></tr>)}</tbody></table>
    </figure>
  );
}

export interface WfItem { label: string; value: number }

/** Probability waterfall: dataset average -> each driver -> this estimate. Direction is shown by arrow and sign, never colour alone. */
export function Waterfall({ base, items, final }: { base: number; items: WfItem[]; final: number }) {
  const all = [base, final, ...items.reduce<number[]>((acc, it) => [...acc, (acc[acc.length - 1] ?? base) + it.value], [])];
  const max = Math.max(0.05, ...all) * 1.08, row = 34, left = 150, w = 480, h = (items.length + 2) * row + 8;
  const X = (v: number) => left + (v / max) * (w - left - 56);
  let run = base;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" className="w-full"
      aria-label={`Estimate walk: average ${(base * 100).toFixed(1)} percent, ${items.map((i) => `${i.label} ${i.value >= 0 ? "adds" : "removes"} ${Math.abs(i.value * 100).toFixed(1)} points`).join(", ")}, giving ${(final * 100).toFixed(1)} percent.`}>
      <Bar y={4} label="Dataset average" from={0} to={base} X={X} fill="#8a97b3" text={`${(base * 100).toFixed(1)}%`} />
      {items.map((it, i) => { const from = run; run += it.value;
        return <Bar key={it.label} y={4 + (i + 1) * row} label={it.label} from={Math.min(from, run)} to={Math.max(from, run)} X={X}
          fill={it.value >= 0 ? "#e5534b" : "#22b573"} text={`${it.value >= 0 ? "▲ +" : "▼ −"}${Math.abs(it.value * 100).toFixed(1)}`} />; })}
      <Bar y={4 + (items.length + 1) * row} label="This estimate" from={0} to={final} X={X} fill={BRAND} text={`${(final * 100).toFixed(1)}%`} bold />
    </svg>
  );
}
function Bar({ y, label, from, to, X, fill, text, bold }: { y: number; label: string; from: number; to: number; X: (v: number) => number; fill: string; text: string; bold?: boolean }) {
  const x = X(from), wd = Math.max(3, X(to) - X(from));
  return (<g><text x="0" y={y + 17} fontSize="11.5" fill={INK} fontWeight={bold ? 700 : 500}>{label.length > 24 ? label.slice(0, 23) + "…" : label}</text>
    <rect x={x} y={y + 4} width={wd} height="18" rx="5" fill={fill} /><text x={x + wd + 6} y={y + 17} fontSize="11.5" fill={INK} fontWeight="700" className="num">{text}</text></g>);
}

export function HBars({ rows, unit = "", label }: { rows: { name: string; value: number }[]; unit?: string; label: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1e-9);
  return (
    <ul aria-label={label} className="space-y-2">
      {rows.map((r) => (
        <li key={r.name} className="text-sm"><div className="flex justify-between"><span>{r.name}</span><span className="num font-semibold">{r.value.toFixed(3)}{unit}</span></div>
          <div className="mt-1 h-2.5 rounded-full bg-dim"><div className="h-2.5 rounded-full bg-brand" style={{ width: `${(r.value / max) * 100}%` }} /></div></li>
      ))}
    </ul>
  );
}
