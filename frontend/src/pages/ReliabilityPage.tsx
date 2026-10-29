import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Condition, EvalItem } from "../api/types";
import { HBars, LineChart } from "../components/charts/Charts";
import { CardTitle, Glass } from "../components/ui/Glass";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";

const NAME: Record<string, string> = { logistic_regression: "Logistic regression", random_forest: "Random forest" };
const f3 = (n: number) => n.toFixed(3);

function Metrics({ item }: { item: EvalItem }) {
  const m = item.metrics, prim = m.models[m.primary_algorithm].test, op = prim.at_operating_threshold, cm = op.confusion_matrix;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Glass className="p-5 lg:col-span-2" aria-label="Intended use">
        <CardTitle>What this model is, and is not</CardTitle>
        <dl className="grid gap-3 text-sm md:grid-cols-3">
          <div><dt className="font-semibold">Intended use</dt><dd className="text-muted">{item.intended_use}</dd></div>
          <div><dt className="font-semibold">Who it was trained on</dt><dd className="text-muted">{item.population_note}</dd></div>
          <div><dt className="font-semibold">What the label means</dt><dd className="text-muted">{item.outcome_definition}</dd></div>
        </dl>
      </Glass>

      <Glass className="p-5" aria-label="Model comparison">
        <CardTitle>Two models, one rule</CardTitle>
        <p className="mb-3 text-sm text-muted">{m.selection_rule} Primary model: <strong>{NAME[m.primary_algorithm]}</strong>. Scores are on {m.split.test_rows} held-out rows, so small differences are noise.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-xs text-muted"><th className="py-1">Model</th><th>CV AUC</th><th>Test AUC</th><th>Brier</th><th>Calib. gap</th></tr></thead>
          <tbody>{Object.entries(m.models).map(([k, v]) => (<tr key={k} className="border-t border-line"><td className="py-1.5 font-medium">{NAME[k]}{v.is_primary ? " ★" : ""}</td>
            <td className="num">{f3(v.cv_roc_auc_train)} ± {f3(v.cv_roc_auc_std)}</td><td className="num">{f3(v.test.roc_auc)}</td><td className="num">{f3(v.test.brier_score)}</td><td className="num">{f3(v.test.calibration_gap.mean_abs)}</td></tr>))}</tbody></table></div>
        <p className="mt-2 text-xs text-muted">★ primary. AUC: 0.5 is a coin flip, 1.0 is perfect. Brier and calibration gap: lower is better.</p>
      </Glass>

      <Glass className="p-5" aria-label="Errors at the operating threshold">
        <CardTitle>What the mistakes look like</CardTitle>
        <p className="mb-2 text-sm text-muted">At the cut-off {pct1(op.threshold)} (chosen on training data), out of {m.split.test_rows} test rows:</p>
        <table className="w-full max-w-sm text-center text-sm" aria-label="Confusion matrix"><thead><tr className="text-xs text-muted"><th><span className="sr-only">Actual condition</span></th><th>Model says higher</th><th>Model says lower</th></tr></thead>
          <tbody><tr><th className="text-left text-xs text-muted">Condition present</th><td className="panel-dim num p-2 font-bold">{cm.tp} <span className="block text-[11px] font-normal text-muted">caught</span></td><td className="num p-2 font-bold text-high">{cm.fn} <span className="block text-[11px] font-normal text-muted">missed</span></td></tr>
            <tr><th className="text-left text-xs text-muted">Not present</th><td className="num p-2 font-bold text-moderate">{cm.fp} <span className="block text-[11px] font-normal text-muted">false alarm</span></td><td className="panel-dim num p-2 font-bold">{cm.tn} <span className="block text-[11px] font-normal text-muted">correct</span></td></tr></tbody></table>
        <p className="num mt-3 text-sm">Sensitivity {pct1(op.sensitivity)} · Specificity {pct1(op.specificity)} · Precision {pct1(op.precision)}</p>
      </Glass>

      <Glass className="p-5" aria-label="ROC curve">
        <CardTitle>ROC curve (test set)</CardTitle>
        <LineChart title="ROC curve" xLabel="False positive rate" yLabel="True positive rate" diagonal xmin={0} xmax={1} ymin={0} ymax={1}
          points={prim.roc_curve.fpr.map((x, i) => ({ x, y: prim.roc_curve.tpr[i] }))} />
      </Glass>
      <Glass className="p-5" aria-label="Calibration">
        <CardTitle>Calibration: do 30% estimates mean 30%?</CardTitle>
        <LineChart title="Calibration curve" xLabel="Estimated probability" yLabel="Actual share" diagonal xmin={0} xmax={1} ymin={0} ymax={1}
          points={prim.calibration_curve.mean_predicted.map((x, i) => ({ x, y: prim.calibration_curve.fraction_positive[i] }))} />
        <p className="text-xs text-muted">The dashed line is perfect calibration. With {m.split.test_rows} test rows each point rests on few people, so it wobbles. Worst gap: {pct1(prim.calibration_gap.max_abs)}.</p>
      </Glass>

      <Glass className="p-5" aria-label="Importance">
        <CardTitle>What the model relies on</CardTitle>
        <HBars label="Permutation importance" unit=" AUC" rows={m.permutation_importance.map((p) => ({ name: p.feature, value: p.mean_auc_drop }))} />
        <p className="mt-2 text-xs text-muted">How much test AUC drops when a column is shuffled. Reliance is not causation.</p>
      </Glass>
      <Glass className="p-5" aria-label="Data quality">
        <CardTitle>Data and trust notes</CardTitle>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>{m.data.rows} rows, {m.data.positives} with the outcome.</li>
          {Object.entries(m.data.zeros_treated_as_missing).filter(([, n]) => n > 0).map(([k, n]) => <li key={k}>{n} impossible zero values in {k} were treated as missing, then imputed inside each training fold.</li>)}
          <li>On average the two models differ by {m.trust_meter_on_test.mean_lr_rf_disagreement_pp.toFixed(1)} points; {pct1(m.trust_meter_on_test.share_disagreeing_over_10pp)} of test cases differ by more than 10.</li>
          <li>Typical model range width: {(m.trust_meter_on_test.mean_bootstrap_range_width * 100).toFixed(1)} points. This is model variability, not a confidence interval.</li>
        </ul>
        <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium text-brand">Full model card</summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-dim p-3 text-xs">{item.model_card_markdown}</pre></details>
      </Glass>
    </div>
  );
}
const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;

export function ReliabilityPage() {
  const [items, setItems] = useState<EvalItem[] | null>(null);
  const [missing, setMissing] = useState<Condition[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.get<{ items: EvalItem[]; unavailable: Condition[] }>("/models/evaluation").then((r) => { setItems(r.items); setMissing(r.unavailable); }).catch((e) => setErr(e.message ?? "Could not load."));
  }, []);
  if (err) return <ErrorState message={err} />;
  if (!items) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-4">
      <Glass className="p-5"><h1 className="text-2xl font-bold tracking-tight">Model reliability</h1>
        <p className="mt-1 text-sm text-muted">Everything here was measured on public research datasets, not on you. These are experimental estimates, not diagnoses.</p></Glass>
      {items.map((it) => <section key={it.condition} aria-label={`${it.condition} evaluation`}><h2 className="mb-2 inline-block rounded-full bg-card/80 px-4 py-1 text-lg font-semibold">{it.condition === "diabetes" ? "Diabetes" : "Heart disease"} <span className="text-sm font-normal text-muted">v{it.version}</span></h2><Metrics item={it} /></section>)}
      {missing.map((c) => <EmptyState key={c} title={`${c === "diabetes" ? "Diabetes" : "Heart disease"} model not trained`}>No evaluation is shown because there is no model yet.</EmptyState>)}
    </div>
  );
}
