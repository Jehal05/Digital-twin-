import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { GoalPlan, Prediction, Scenario } from "../api/types";
import { useDashboard } from "../auth/DataContext";
import { DIABETES_FIELDS } from "../components/dashboard/EstimateForm";
import { Button } from "../components/ui/Button";
import { ContentTag, ExperimentalNote } from "../components/ui/ContentTag";
import { CardTitle, Glass } from "../components/ui/Glass";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { BAND_CHIP, BAND_LABEL, pct } from "../lib/format";

/** Only these inputs can be changed. The rest describe who the person is and are shown read-only. */
const EDITABLE = ["glucose", "blood_pressure", "bmi"];

const signed = (pp: number) => `${pp > 0 ? "+" : pp < 0 ? "−" : ""}${Math.abs(pp).toFixed(1)} pts`;

function Compare({ base, scen }: { base: Prediction; scen: Prediction }) {
  const Row = ({ p, tag, label }: { p: Prediction; tag: "ai_estimate" | "hypothetical"; label: string }) => (
    <div className={`rounded-2xl p-4 ${tag === "hypothetical" ? "hatched border border-dashed border-brand bg-card/60" : "bg-card/80"}`}>
      <div className="flex items-center justify-between"><span className="text-sm font-semibold">{label}</span><ContentTag kind={tag} /></div>
      <p className="num mt-1 text-3xl font-bold">{pct(p.score, 1)}</p>
      <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${BAND_CHIP[p.risk_band]}`}>{BAND_LABEL[p.risk_band]}</span>
    </div>
  );
  const delta = (scen.score - base.score) * 100;
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Baseline compared with scenario">
      <Row p={base} tag="ai_estimate" label="Your baseline" />
      <Row p={scen} tag="hypothetical" label="What-if" />
      <p className="num text-sm font-semibold sm:col-span-2" aria-live="polite">Change in this model's estimate: {signed(delta)}</p>
    </div>
  );
}

export function SimulatorPage() {
  const { data, error, reload } = useDashboard();
  const base = data?.latest_predictions.diabetes ?? null;
  const [vals, setVals] = useState<Record<string, number>>({});
  const [result, setResult] = useState<Scenario | null>(null);
  const [saved, setSaved] = useState<Scenario[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [target, setTarget] = useState(20);
  const [locked, setLocked] = useState<string[]>([]);
  const [plan, setPlan] = useState<GoalPlan | null>(null);

  const loadSaved = useCallback(async () => {
    try { setSaved((await api.get<{ items: Scenario[] }>("/scenarios?condition=diabetes")).items); } catch { setSaved([]); }
  }, []);
  useEffect(() => { void loadSaved(); }, [loadSaved]);
  useEffect(() => { if (base) { setVals(Object.fromEntries(EDITABLE.map((f) => [f, base.input_snapshot[f]]))); setResult(null); setPlan(null); } }, [base?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = useMemo(() => base ? Object.fromEntries(EDITABLE.filter((f) => vals[f] !== undefined && vals[f] !== base.input_snapshot[f]).map((f) => [f, vals[f]])) : {}, [vals, base]);
  const fail = (e: unknown) => setMsg(e instanceof ApiError ? e.message : "Something went wrong.");

  async function run() {
    if (!base) return;
    setBusy(true); setMsg("");
    try {
      const names = Object.keys(changed).map((k) => DIABETES_FIELDS.find((f) => f.name === k)?.label ?? k).join(", ");
      const s = await api.post<Scenario>("/scenarios", { name: `What if: ${names}`.slice(0, 80), condition: "diabetes", baseline_prediction_id: base.id, changed_inputs: changed });
      setResult(s); await loadSaved(); await reload();
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function solve() {
    if (!base) return;
    setBusy(true); setMsg(""); setPlan(null);
    try {
      const g = await api.post<GoalPlan>("/scenarios/goal-plan", { condition: "diabetes", baseline_prediction_id: base.id, target_score: target / 100, locked_inputs: locked });
      setPlan(g); if (g.scenario) { setResult(g.scenario); await loadSaved(); }
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  if (!data) return error ? <ErrorState message={error.message} onRetry={() => void reload()} /> : <Skeleton className="h-96" />;
  if (!base) return <EmptyState title="Get a baseline first" action={<Link to="/"><Button>Go to dashboard</Button></Link>}>The simulator changes a real estimate. Run an estimate on the dashboard, then come back.</EmptyState>;

  const chosen = (saved ?? []).filter((s) => picked.includes(s.id));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Glass className="p-5" aria-label="What-if simulator">
        <CardTitle aside={<ContentTag kind="hypothetical" />}>What-If Simulator</CardTitle>
        <p className="mb-4 text-sm text-muted">Your baseline stays fixed. Change an input you can actually influence and the real model is run again on the new numbers.</p>
        <div className="space-y-5">
          {EDITABLE.map((name) => {
            const f = DIABETES_FIELDS.find((x) => x.name === name)!;
            const b = base.input_snapshot[name], v = vals[name] ?? b;
            return (
              <div key={name}>
                <div className="flex items-baseline justify-between"><label htmlFor={`sl-${name}`} className="text-sm font-medium">{f.label}</label>
                  <span className="num text-sm"><strong>{v}</strong> {f.unit} <span className="text-muted">(baseline {b})</span></span></div>
                <input id={`sl-${name}`} type="range" min={f.min} max={f.max} step={f.step} value={v} className="mt-1 w-full accent-brand"
                  onChange={(e) => setVals({ ...vals, [name]: Number(e.target.value) })} />
              </div>
            );
          })}
          <div className="panel-dim p-3 text-xs"><p className="font-semibold">Fixed inputs (cannot be simulated)</p>
            <dl className="mt-2 grid grid-cols-2 gap-2">{["age", "pregnancies"].map((k) => <div key={k} className="flex justify-between"><dt className="capitalize text-muted">{k}</dt><dd className="num font-semibold">{base.input_snapshot[k]}</dd></div>)}</dl></div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => void run()} disabled={busy || Object.keys(changed).length === 0}>{busy ? "Running…" : "Run scenario"}</Button>
          <Button variant="ghost" onClick={() => setVals(Object.fromEntries(EDITABLE.map((f) => [f, base.input_snapshot[f]])))}>Reset</Button>
        </div>
        {msg && <p role="alert" className="mt-3 text-sm font-medium text-high">{msg}</p>}
        {result && <div className="mt-5 space-y-2"><Compare base={result.baseline} scen={result.scenario} /><p className="text-xs text-muted">{result.note}</p></div>}
        <ExperimentalNote className="mt-3" />
      </Glass>

      <div className="space-y-4">
        <Glass className="p-5" aria-label="Goal planner">
          <CardTitle aside={<ContentTag kind="hypothetical" />}>Goal Planner</CardTitle>
          <p className="mb-3 text-sm text-muted">Pick a target. The planner searches realistic decreases with the real model and returns the smallest change it found.</p>
          <label htmlFor="goal" className="text-sm font-medium">Target: estimate below <span className="num font-bold">{target}%</span> <span className="text-muted">(baseline {pct(base.score, 1)})</span></label>
          <input id="goal" type="range" min={2} max={Math.max(3, Math.floor(base.score * 100) - 1)} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="mt-1 w-full accent-brand" />
          <fieldset className="mt-2 flex flex-wrap gap-4 text-sm"><legend className="text-xs text-muted">Keep these unchanged</legend>
            {EDITABLE.map((f) => <label key={f} className="flex items-center gap-1.5"><input type="checkbox" checked={locked.includes(f)}
              onChange={(e) => setLocked(e.target.checked ? [...locked, f] : locked.filter((x) => x !== f))} />{DIABETES_FIELDS.find((x) => x.name === f)?.label}</label>)}</fieldset>
          <Button className="mt-3" onClick={() => void solve()} disabled={busy || target / 100 >= base.score}>Find a plan</Button>
          {plan && (
            <div className="mt-4 text-sm" role="status">
              {plan.message && <p className="rounded-xl bg-moderate-bg p-3 font-medium text-moderate">{plan.message}</p>}
              {Object.keys(plan.changes).length > 0 && (
                <ul className="mt-2 space-y-1">{Object.entries(plan.changes).map(([k, v]) => (
                  <li key={k} className="panel-dim flex justify-between p-2"><span>{DIABETES_FIELDS.find((f) => f.name === k)?.label ?? k}</span>
                    <span className="num font-semibold">{base.input_snapshot[k]} → {v}</span></li>))}</ul>)}
              <p className="num mt-2">Model estimate with these changes: <strong>{pct(plan.estimated_score, 1)}</strong></p>
              <p className="mt-1 text-xs text-muted">{plan.note}</p>
            </div>
          )}
        </Glass>

        <Glass className="p-5" aria-label="Saved scenarios">
          <CardTitle>Saved scenarios</CardTitle>
          {saved === null ? <Skeleton className="h-16" /> : saved.length === 0 ? <EmptyState title="Nothing saved yet">Run a scenario and it will appear here for comparison.</EmptyState> : (
            <>
              <ul className="space-y-2">
                {saved.map((s) => (
                  <li key={s.id} className="panel-dim flex items-center gap-3 p-2.5 text-sm">
                    <input type="checkbox" aria-label={`Compare ${s.name}`} checked={picked.includes(s.id)} disabled={!picked.includes(s.id) && picked.length >= 4}
                      onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="num font-semibold">{pct(s.scenario.score, 1)}</span>
                    <span className="num text-xs text-muted">{signed(s.delta_pp)}</span>
                    <button className="text-xs font-semibold text-high underline" aria-label={`Delete ${s.name}`}
                      onClick={async () => { try { await api.del(`/scenarios/${s.id}`); setPicked(picked.filter((x) => x !== s.id)); await loadSaved(); await reload(); } catch (e) { fail(e); } }}>Delete</button>
                  </li>))}
              </ul>
              {chosen.length >= 2 && (
                <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-1 text-left text-xs text-muted">Hypothetical estimates compared with your real baseline</caption>
                  <thead><tr className="text-xs text-muted"><th className="py-1">Scenario</th><th>Changes</th><th className="text-right">Estimate</th><th className="text-right">Δ</th></tr></thead>
                  <tbody>
                    <tr className="border-t border-line"><td className="py-1.5 font-semibold">Baseline <ContentTag kind="ai_estimate" /></td><td>—</td><td className="num text-right font-semibold">{pct(base.score, 1)}</td><td /></tr>
                    {chosen.map((s) => (<tr key={s.id} className="hatched border-t border-line"><td className="py-1.5">{s.name}</td>
                      <td className="text-xs">{Object.entries(s.changed_inputs).map(([k, v]) => `${k} ${s.baseline.input_snapshot[k]}→${v}`).join(", ")}</td>
                      <td className="num text-right font-semibold">{pct(s.scenario.score, 1)}</td><td className="num text-right">{signed(s.delta_pp)}</td></tr>))}
                  </tbody></table></div>)}
            </>
          )}
        </Glass>
      </div>
    </div>
  );
}
