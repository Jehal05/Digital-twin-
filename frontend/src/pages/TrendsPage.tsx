import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Prediction } from "../api/types";
import { useDashboard } from "../auth/DataContext";
import { LineChart } from "../components/charts/Charts";
import { Button } from "../components/ui/Button";
import { ContentTag, ExperimentalNote } from "../components/ui/ContentTag";
import { CardTitle, Glass } from "../components/ui/Glass";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { BAND_CHIP, BAND_LABEL, MEASUREMENT_LABEL, pct, shortDate } from "../lib/format";

function Measured() {
  const { data } = useDashboard();
  const keys = Object.keys(data?.trend_series ?? {}).filter((k) => (data!.trend_series[k]?.length ?? 0) > 0);
  const [sel, setSel] = useState("");
  const key = keys.includes(sel) ? sel : keys[0];
  if (!data) return null;
  const series = key ? data.trend_series[key] : [];
  const unit = series[0]?.unit ?? "";
  return (
    <Glass className="p-5" aria-label="Measured trends">
      <CardTitle aside={<ContentTag kind="measured" />}>Your readings over time</CardTitle>
      {keys.length === 0 ? <EmptyState title="No readings yet" action={<Link to="/profile"><Button>Add a reading</Button></Link>}>Trends appear once you have saved readings.</EmptyState> : (
        <>
          <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Measurement">
            {keys.map((k) => <button key={k} role="tab" aria-selected={k === key} onClick={() => setSel(k)}
              className={`rounded-full px-3 py-1 text-sm font-medium ${k === key ? "bg-brand text-on-strong" : "bg-card/70 hover:bg-card"}`}>{MEASUREMENT_LABEL[k] ?? k}</button>)}
          </div>
          {series.length < 2 ? <p className="text-sm text-muted">One reading so far: <strong className="num">{series[0].value} {unit}</strong>. Add another to see a trend.</p> : (
            <LineChart title={`${MEASUREMENT_LABEL[key] ?? key} over time`} xLabel="Date" yLabel={unit}
              points={series.map((p) => ({ x: new Date(p.recorded_at).getTime(), y: p.value, label: shortDate(p.recorded_at) }))}
              xFmt={(n) => shortDate(new Date(n).toISOString())} />
          )}
          {series.some((p) => p.validation_status === "flagged") && <p className="mt-2 text-xs font-medium text-moderate">Some readings in this series are flagged as unusual. Review them under My data.</p>}
        </>
      )}
    </Glass>
  );
}

function TimeMachine() {
  const [items, setItems] = useState<Prediction[] | null>(null);
  const [err, setErr] = useState("");
  const [i, setI] = useState(-1);
  useEffect(() => {
    api.get<{ items: Prediction[] }>("/predictions/history?condition=diabetes&limit=200")
      .then((r) => setItems([...r.items].reverse())).catch((e) => setErr(e.message ?? "Could not load history."));
  }, []);
  const list = items ?? [];
  const idx = i < 0 ? list.length - 1 : Math.min(i, list.length - 1);
  const cur = list[idx];
  const versions = useMemo(() => new Set(list.map((p) => p.model.version)), [list]);
  return (
    <Glass className="p-5" aria-label="Time Machine">
      <CardTitle aside={<ContentTag kind="ai_estimate" />}>Time Machine</CardTitle>
      {err ? <ErrorState message={err} /> : items === null ? <Skeleton className="h-48" /> : list.length === 0 ? (
        <EmptyState title="No past estimates">Each estimate you run is kept, so you can scrub back through them here.</EmptyState>
      ) : (
        <>
          {list.length >= 2 && <LineChart title="Diabetes model estimate over time" xLabel="Date" yLabel="Estimate (%)" ymin={0}
            points={list.map((p) => ({ x: new Date(p.created_at).getTime(), y: p.score * 100, label: shortDate(p.created_at) }))} xFmt={(n) => shortDate(new Date(n).toISOString())} />}
          {list.length >= 2 && (<><label htmlFor="tm" className="mt-2 block text-sm font-medium">Go back to: <span className="num">{new Date(cur.created_at).toLocaleString()}</span></label>
            <input id="tm" type="range" min={0} max={list.length - 1} value={idx} onChange={(e) => setI(Number(e.target.value))} className="w-full accent-brand" /></>)}
          <div className="panel-dim mt-3 p-3 text-sm" aria-live="polite">
            <p className="flex items-center gap-2"><span className="num text-2xl font-bold">{pct(cur.score, 1)}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BAND_CHIP[cur.risk_band]}`}>{BAND_LABEL[cur.risk_band]}</span></p>
            <p className="mt-1 text-xs text-muted">Inputs then: {Object.entries(cur.input_snapshot).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
            <p className="mt-1 text-xs text-muted">Model v{cur.model.version}</p>
          </div>
          {versions.size > 1 && <p className="mt-2 text-xs font-medium text-moderate">These estimates come from different model versions, so differences may reflect the model and not you.</p>}
          <ExperimentalNote className="mt-2" />
        </>
      )}
    </Glass>
  );
}

export function TrendsPage() {
  const { data, error, reload } = useDashboard();
  if (!data) return error ? <ErrorState message={error.message} onRetry={() => void reload()} /> : <Skeleton className="h-96" />;
  return <div className="grid gap-4 lg:grid-cols-2"><Measured /><TimeMachine /></div>;
}
