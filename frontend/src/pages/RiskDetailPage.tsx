import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { CohortPercentile, Condition } from "../api/types";
import { useDashboard } from "../auth/DataContext";
import { Waterfall } from "../components/charts/Charts";
import { RiskGauge } from "../components/dashboard/RiskGauge";
import { ContentTag } from "../components/ui/ContentTag";
import { CardTitle, Glass } from "../components/ui/Glass";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { Button } from "../components/ui/Button";

const SHORT: Record<string, string> = { glucose: "Glucose", bmi: "BMI", blood_pressure: "Diastolic BP", age: "Age", pregnancies: "Pregnancies" };
const PERCENTILE_FEATURES: Record<Condition, string[]> = { diabetes: ["glucose", "bmi", "blood_pressure", "age"], heart_disease: [] };

function Cohort({ condition, snapshot }: { condition: Condition; snapshot: Record<string, number> }) {
  const [rows, setRows] = useState<CohortPercentile[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all(PERCENTILE_FEATURES[condition].filter((f) => f in snapshot).map((f) =>
      api.get<CohortPercentile>(`/cohort/percentile?condition=${condition}&feature=${f}&value=${snapshot[f]}`)))
      .then((r) => live && setRows(r)).catch(() => live && setErr(true));
    return () => { live = false; };
  }, [condition, snapshot]);
  return (
    <Glass className="p-5" aria-label="Cohort comparison">
      <CardTitle aside={<ContentTag kind="cohort_comparison" />}>Where you sit in the study group</CardTitle>
      {err ? <p role="alert" className="text-sm text-high">Could not load the comparison.</p> : !rows ? <Skeleton className="h-24" /> : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.label} className="text-sm">
              <div className="flex justify-between"><span>{r.label}</span><span className="num font-semibold">{r.percentile.toFixed(0)}th percentile</span></div>
              <div className="relative mt-1 h-2.5 rounded-full bg-dim" role="img" aria-label={`${r.label}: ${r.percentile.toFixed(0)}th percentile of the study group`}>
                <span className="absolute top-[-3px] h-4 w-1.5 -translate-x-1/2 rounded-full bg-ink ring-2 ring-white" style={{ left: `${r.percentile}%` }} />
              </div>
              {r.outside_cohort_range && <p className="mt-1 text-xs font-medium text-moderate">Outside the range the model was trained on.</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">Position within this study's training group only (women of Pima heritage, 21 to 81). It says nothing about the general population.</p>
    </Glass>
  );
}

export function RiskDetailPage() {
  const { condition } = useParams();
  const { data, loading, error, reload } = useDashboard();
  if (condition !== "diabetes" && condition !== "heart_disease") return <Navigate to="/risk/diabetes" replace />;
  if (!data) return error ? <ErrorState message={error.message} onRetry={() => void reload()} /> : <Skeleton className="h-96" />;
  const p = data.latest_predictions[condition];
  const available = data.models_available.includes(condition);
  const tabs = (
    <nav aria-label="Condition" className="mb-4 flex gap-2">
      {(["diabetes", "heart_disease"] as Condition[]).map((c) => (
        <Link key={c} to={`/risk/${c}`} aria-current={c === condition ? "page" : undefined}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold ${c === condition ? "bg-brand text-white" : "bg-white/70 hover:bg-white"}`}>{c === "diabetes" ? "Diabetes" : "Heart disease"}</Link>
      ))}
    </nav>
  );
  if (!available) return <>{tabs}<EmptyState title="Heart disease model not available yet">The model needs the UCI Cleveland dataset to be trained. Nothing is shown here until it is, rather than an invented number.</EmptyState></>;
  if (!p) return <>{tabs}<EmptyState title="No estimate yet" action={<Link to="/"><Button>Go to dashboard</Button></Link>}>Run your first estimate from the dashboard.</EmptyState></>;

  const drivers = p.explanation?.top_drivers ?? [];
  const base = p.explanation?.base_value ?? 0;
  const sum = drivers.reduce((a, d) => a + d.effect, 0);
  const residual = p.score - base - sum;
  const items = [...drivers.map((d) => ({ label: `${SHORT[d.feature] ?? d.label} ${d.value}`, value: d.effect })), ...(Math.abs(residual) >= 0.005 ? [{ label: "Other / rounding", value: residual }] : [])];
  return (
    <div aria-busy={loading}>
      {tabs}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4"><RiskGauge p={p} /><Cohort condition={condition} snapshot={p.input_snapshot} /></div>
        <Glass className="h-fit p-5" aria-label="Explanation">
          <CardTitle aside={<ContentTag kind="ai_estimate" />}>How the estimate is built</CardTitle>
          <p className="mb-3 text-sm text-muted">Starting from the study average, each input moves the estimate up or down. Values are percentage points.</p>
          <Waterfall base={base} items={items} final={p.score} />
          <p className="mt-3 text-xs text-muted">{p.explanation?.reference ?? p.explanation?.note}</p>
          <p className="mt-2 text-xs text-muted">Method: {p.explanation?.method}. This describes how the model behaves; it does not show what causes disease.</p>
        </Glass>
      </div>
    </div>
  );
}
