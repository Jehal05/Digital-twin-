import type { Condition, Prediction } from "../../api/types";
import { BAND_CHIP, BAND_LABEL, pct, timeAgo } from "../../lib/format";
import { Button } from "../ui/Button";
import { ContentTag, ExperimentalNote } from "../ui/ContentTag";
import { Glass } from "../ui/Glass";

const NAME: Record<Condition, string> = { diabetes: "Diabetes", heart_disease: "Heart disease" };

export function DiseaseCard({ condition, prediction, available, active, onSelect, onRun }: {
  condition: Condition; prediction: Prediction | null; available: boolean; active: boolean;
  onSelect(): void; onRun(): void;
}) {
  return (
    <Glass as="article" className={`p-4 ${active ? "ring-2 ring-brand" : ""}`} aria-label={`${NAME[condition]} summary`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{NAME[condition]}</h3>
        {prediction ? <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BAND_CHIP[prediction.risk_band]}`}>{BAND_LABEL[prediction.risk_band]}</span>
          : <span className="rounded-full bg-dim px-2.5 py-0.5 text-xs font-semibold text-muted">{available ? "No estimate yet" : "Not available"}</span>}
      </div>

      {!available ? (
        <p className="mt-3 text-sm text-muted">This model has not been trained yet. The heart disease estimate needs the UCI Cleveland dataset.</p>
      ) : prediction ? (
        <>
          <p className="num mt-2 text-3xl font-bold">{pct(prediction.score, 1)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2"><ContentTag kind="ai_estimate" /><span className="text-xs text-muted">{timeAgo(prediction.created_at)} · v{prediction.model.version}</span></div>
          <ExperimentalNote className="mt-2" />
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">Enter your numbers to get a model estimate.</p>
      )}

      <div className="mt-3 flex gap-2">
        {prediction && <Button variant="secondary" className="min-h-9 px-4" onClick={onSelect} aria-pressed={active}>{active ? "Showing" : "Show details"}</Button>}
        <Button variant={prediction ? "ghost" : "primary"} className="min-h-9 px-4" onClick={onRun} disabled={!available}>{prediction ? "Update" : "Get estimate"}</Button>
      </div>
    </Glass>
  );
}
