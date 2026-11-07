import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Condition, Prediction } from "../../api/types";
import { featureLabel, featureValue } from "../../lib/format";
import { Button } from "../ui/Button";
import { ContentTag } from "../ui/ContentTag";
import { CardTitle, Glass } from "../ui/Glass";

interface Path { label: string; scores: number[]; assumptions: { input: string; assumption: string }[]; changes?: Record<string, number>; reaches_target?: boolean }
interface FuturesData { months: number; carry_on: Path; improve: Path; note: string }

/** B5: two hypothetical six-month paths, drawn as lines and also given as a table. */
export function Futures({ p, condition }: { p: Prediction; condition: Condition }) {
  const [d, setD] = useState<FuturesData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setD(null); setErr(null); }, [p.id]);
  const run = async () => {
    setBusy(true); setErr(null);
    try { setD(await api.post<FuturesData>("/scenarios/futures", { condition, baseline_prediction_id: p.id })); }
    catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); }
  };
  const W = 320, H = 150, L = 34, B = 22;
  const all = d ? [...d.carry_on.scores, ...d.improve.scores] : [];
  const lo = d ? Math.max(0, Math.min(...all) - 0.03) : 0, hi = d ? Math.min(1, Math.max(...all) + 0.03) : 1;
  const x = (m: number) => L + (m / 6) * (W - L - 6), y = (v: number) => 6 + (1 - (v - lo) / (hi - lo || 1)) * (H - B - 6);
  const line = (s: number[]) => s.map((v, m) => `${m ? "L" : "M"}${x(m).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <Glass className="p-5 lg:col-span-2" aria-label="Twin futures">
      <CardTitle aside={<ContentTag kind="hypothetical" />}>Twin Futures: the next six months</CardTitle>
      <p className="mb-3 text-sm text-muted">Two what-if paths scored month by month by the model. Not a forecast: it shows how this model's estimate would respond, nothing more.</p>
      <Button onClick={run} disabled={busy}>{busy ? "Calculating…" : d ? "Recalculate" : "Show both futures"}</Button>
      {err && <p role="alert" className="mt-2 text-sm text-high">{err}</p>}
      {d && (
        <div className="mt-4 grid gap-4 md:grid-cols-2" data-testid="futures">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" className="w-full" aria-label={`Hypothetical estimate over six months. Carry on as now ends at ${(d.carry_on.scores[6] * 100).toFixed(1)} percent. Improve habits ends at ${(d.improve.scores[6] * 100).toFixed(1)} percent.`}>
            {[0, 1, 2, 3, 4, 5, 6].map((m) => <text key={m} x={x(m)} y={H - 6} textAnchor="middle" fontSize="9" className="fill-muted">{m}</text>)}
            {[lo, (lo + hi) / 2, hi].map((v) => <text key={v} x={L - 4} y={y(v) + 3} textAnchor="end" fontSize="9" className="fill-muted">{(v * 100).toFixed(0)}%</text>)}
            <path d={line(d.carry_on.scores)} fill="none" strokeWidth="2.5" strokeDasharray="5 3" className="stroke-ink-muted" />
            <path d={line(d.improve.scores)} fill="none" strokeWidth="2.5" className="stroke-brand" />
          </svg>
          <div className="text-sm">
            <p><span aria-hidden>╌╌ </span><strong>Carry on as now</strong>: {(d.carry_on.scores[0] * 100).toFixed(1)}% → <span className="num">{(d.carry_on.scores[6] * 100).toFixed(1)}%</span></p>
            <ul className="mb-2 list-disc pl-5 text-xs text-muted">{d.carry_on.assumptions.map((a) => <li key={a.input}>{featureLabel(a.input, a.input)}: {a.assumption}</li>)}</ul>
            <p><span aria-hidden>── </span><strong>Improve habits</strong>: {(d.improve.scores[0] * 100).toFixed(1)}% → <span className="num">{(d.improve.scores[6] * 100).toFixed(1)}%</span></p>
            <ul className="list-disc pl-5 text-xs text-muted">{d.improve.assumptions.map((a) => <li key={a.input}>{featureLabel(a.input, a.input)} ({featureValue(a.input, p.input_snapshot[a.input])} → {featureValue(a.input, d.improve.changes![a.input])}): {a.assumption}</li>)}
              {!d.improve.assumptions.length && <li>No change in the allowed inputs lowers this estimate.</li>}</ul>
          </div>
          <table className="sr-only"><caption>Estimate by month</caption><thead><tr><th>Month</th><th>Carry on</th><th>Improve</th></tr></thead>
            <tbody>{d.carry_on.scores.map((s, m) => <tr key={m}><td>{m}</td><td>{(s * 100).toFixed(1)}%</td><td>{(d.improve.scores[m] * 100).toFixed(1)}%</td></tr>)}</tbody></table>
          <p className="text-xs text-muted md:col-span-2">{d.note}</p>
        </div>)}
    </Glass>
  );
}
