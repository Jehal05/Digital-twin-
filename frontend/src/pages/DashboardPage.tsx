import { useState } from "react";
import type { Condition, Prediction } from "../api/types";
import { useDashboard } from "../auth/DataContext";
import { DiseaseCard } from "../components/dashboard/DiseaseCard";
import { EstimateForm } from "../components/dashboard/EstimateForm";
import { MeasurementsCard } from "../components/dashboard/MeasurementsCard";
import { RiskGauge } from "../components/dashboard/RiskGauge";
import { WhyRisk } from "../components/dashboard/WhyRisk";
import { DigitalTwin } from "../components/twin/DigitalTwin";
import { CardTitle, Glass } from "../components/ui/Glass";
import { ErrorState, Skeleton } from "../components/ui/States";

export function DashboardPage() {
  const { data, loading, error, reload } = useDashboard();
  const [selected, setSelected] = useState<Condition>("diabetes");
  const [editing, setEditing] = useState(false);

  if (!data) {
    return error ? <ErrorState message={error.message} onRetry={() => void reload()} /> : (
      <div aria-busy="true" aria-label="Loading dashboard" className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-72" /><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
    );
  }
  const preds = data.latest_predictions;
  const shown: Prediction | null = preds[selected];
  const done = async (p: Prediction) => { setEditing(false); setSelected(p.condition); await reload(); };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr_1fr]" aria-busy={loading}>
      <div className="space-y-4">
        {editing ? (
          <Glass className="p-5" aria-label="New estimate"><CardTitle>New {selected === "diabetes" ? "diabetes" : "heart disease"} estimate</CardTitle>
            <EstimateForm condition={selected} data={data} onDone={(p) => void done(p)} onCancel={() => setEditing(false)} /></Glass>
        ) : shown ? <RiskGauge p={shown} />
          : <Glass className="p-5" aria-label="No estimate"><CardTitle>{selected === "diabetes" ? "Diabetes" : "Heart disease"} estimate</CardTitle>
            <p className="text-sm text-muted">No estimate yet. Use "Get estimate" on the card to the right.</p></Glass>}
        {shown && !editing && <WhyRisk p={shown} />}
      </div>
      <DigitalTwin predictions={preds} available={data.models_available}
        onSelect={(c) => { setSelected(c); setEditing(false); }} onRun={() => { setSelected("diabetes"); setEditing(true); }} />
      <div className="space-y-4">
        {(["diabetes", "heart_disease"] as Condition[]).map((c) => (
          <DiseaseCard key={c} condition={c} prediction={preds[c]} available={data.models_available.includes(c)} active={selected === c}
            onSelect={() => { setSelected(c); setEditing(false); }} onRun={() => { setSelected(c); setEditing(true); }} />
        ))}
        <MeasurementsCard data={data} />
      </div>
    </div>
  );
}
