import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Condition, Prediction } from "../../api/types";
import { featureLabel, featureValue } from "../../lib/format";
import { Button } from "../ui/Button";
import { ContentTag } from "../ui/ContentTag";
import { CardTitle, Glass } from "../ui/Glass";
import { Skeleton } from "../ui/States";

interface CheckNext { baseline_band: string; note: string; method: string;
  inputs: { feature: string; label: string; value: number; typical_swing_pp: number; range_pp: [number, number]; chance_band_changes: number; rank: number }[] }
interface Counterfactual { feasible: boolean; changes: Record<string, number>; estimated_score: number; baseline_score: number; current_band: string; target_band: string;
  band_edge: number; message?: string; note: string }

/** A5: which entries matter most to this estimate. */
export function CheckNext({ p }: { p: Prediction }) {
  const [d, setD] = useState<CheckNext | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    api.get<CheckNext>(`/predictions/${p.id}/check-next`).then((r) => live && setD(r)).catch(() => live && setErr(true));
    return () => { live = false; };
  }, [p.id]);
  return (
    <Glass className="p-5" aria-label="What to check next">
      <CardTitle aside={<ContentTag kind="ai_estimate" />}>What should I check next?</CardTitle>
      <p className="mb-3 text-sm text-muted">Which of your entries matter most to this estimate. If one is a rough guess, measure it accurately first.</p>
      {err ? <p role="alert" className="text-sm text-high">Could not load this.</p> : !d ? <Skeleton className="h-24" /> : (
        <ol className="space-y-2">
          {d.inputs.slice(0, 5).map((i) => (
            <li key={i.feature} className="panel-dim p-2 text-sm">
              <div className="flex flex-wrap justify-between gap-x-2"><span className="font-semibold">{i.rank}. {featureLabel(i.feature, i.label)} <span className="font-normal text-muted">(you entered {featureValue(i.feature, i.value)})</span></span>
                <span className="num">±{i.typical_swing_pp.toFixed(1)} points typical swing</span></div>
              <p className="text-xs text-muted">Across people in the study, this entry alone would put the estimate between {i.range_pp[0]}% and {i.range_pp[1]}%; the risk band would change for {Math.round(i.chance_band_changes * 100)}% of them.</p>
            </li>))}
        </ol>)}
      <p className="mt-3 text-xs text-muted">{d?.note ?? "Experimental model estimate, not a diagnosis."}</p>
    </Glass>
  );
}

/** A6: smallest realistic change that reaches the next lower band. Hypothetical. */
export function Counterfactual({ p, condition }: { p: Prediction; condition: Condition }) {
  const [d, setD] = useState<Counterfactual | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setD(null); setErr(null); }, [p.id]);
  const run = async () => {
    setBusy(true); setErr(null);
    try { setD(await api.post<Counterfactual>("/scenarios/counterfactual", { condition, baseline_prediction_id: p.id })); }
    catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); }
  };
  return (
    <Glass className="p-5" aria-label="Smallest change to a lower band">
      <CardTitle aside={<ContentTag kind="hypothetical" />}>Smallest change to reach a lower band</CardTitle>
      {p.risk_band === "low" ? <p className="text-sm text-muted">Your estimate is already in the lowest band.</p> : (<>
        <p className="mb-3 text-sm text-muted">Searches the realistic changes this app allows and shows the smallest one for which the model's estimate drops into the next lower band.</p>
        <Button onClick={run} disabled={busy}>{busy ? "Searching…" : "Find the smallest change"}</Button></>)}
      {err && <p role="alert" className="mt-2 text-sm text-high">{err}</p>}
      {d && (
        <div className="mt-3 text-sm" data-testid="counterfactual">
          {d.message && <p>{d.message}</p>}
          {Object.keys(d.changes).length > 0 && (<>
            <ul className="list-disc pl-5">{Object.entries(d.changes).map(([f, v]) => <li key={f}>{featureLabel(f)}: {featureValue(f, p.input_snapshot[f])} → <strong>{featureValue(f, v)}</strong></li>)}</ul>
            <p className="num mt-1">Hypothetical estimate: {(d.baseline_score * 100).toFixed(1)}% → {(d.estimated_score * 100).toFixed(1)}%</p></>)}
          <p className="mt-2 text-xs text-muted">{d.note}</p>
        </div>)}
    </Glass>
  );
}
