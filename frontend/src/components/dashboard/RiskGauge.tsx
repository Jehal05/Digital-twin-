import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useEffect } from "react";
import type { Prediction } from "../../api/types";
import { BAND_CHIP, BAND_LABEL, pct, timeAgo } from "../../lib/format";
import { CardTitle, Glass } from "../ui/Glass";
import { ContentTag, ExperimentalNote } from "../ui/ContentTag";

const TITLE = { diabetes: "Diabetes estimate", diabetes_survey: "Diabetes estimate (lifestyle survey)", heart_disease: "Heart disease estimate" } as const;

function CountUp({ value, reduce }: { value: number; reduce: boolean }) {
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => `${v.toFixed(1)}%`);
  useEffect(() => {
    if (reduce) { mv.set(value); return; }
    const c = animate(mv, value, { duration: 0.9, ease: "easeOut" });
    return () => c.stop();
  }, [value, reduce, mv]);
  return <motion.span aria-hidden className="num text-6xl font-bold leading-none">{text}</motion.span>;
}

export function RiskGauge({ p }: { p: Prediction }) {
  const reduce = useReducedMotion() ?? false;
  const value = p.score * 100;
  const t = p.trust;
  const a = t?.applicability;
  return (
    <Glass className={`p-5 ${a && a.level !== "typical" ? "border-2 border-dashed border-moderate" : ""}`} aria-labelledby="gauge-title">
      <CardTitle aside={<div className="flex items-center gap-2"><ContentTag kind="ai_estimate" /><span className={`rounded-full px-3 py-0.5 text-xs font-semibold ${BAND_CHIP[p.risk_band]}`}>{BAND_LABEL[p.risk_band]}</span></div>}>
        <span id="gauge-title">{TITLE[p.condition]}</span>
      </CardTitle>

      {a && a.level !== "typical" && (
        <div role="note" data-testid="applicability-warning" className="mb-3 rounded-xl border border-moderate bg-moderate-bg text-ink p-3 text-sm">
          <p className="font-semibold">{a.level === "outside" ? "This model may not be for you" : "Lower confidence: unusual inputs"}</p>
          <p>{a.text}</p>
          <ul className="mt-1 list-disc pl-5">{a.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-x-3">
        <CountUp value={value} reduce={reduce} />
        <p className="pb-1 text-sm text-muted">model-estimated probability<br />{timeAgo(p.created_at)} · model v{p.model.version}</p>
      </div>
      <span className="sr-only" data-testid="gauge-value">{`Model-estimated probability ${pct(p.score, 1)}, ${BAND_LABEL[p.risk_band]}.`}</span>

      <div className="mt-5" role="meter" aria-label="Model-estimated probability" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
        <div className="relative h-3 rounded-full risk-bar">
          {t && (
            <div className="absolute top-0 h-3 rounded-full bg-card/45 ring-1 ring-white/80"
              style={{ left: `${t.uncertainty_range.low * 100}%`, width: `${Math.max(1, (t.uncertainty_range.high - t.uncertainty_range.low) * 100)}%` }}
              title={`Model range ${pct(t.uncertainty_range.low)} to ${pct(t.uncertainty_range.high)}`} />
          )}
          <motion.div className="absolute -top-1.5 h-6 w-1.5 -translate-x-1/2 rounded-full bg-ink ring-2 ring-white"
            initial={{ left: reduce ? `${value}%` : "0%" }} animate={{ left: `${value}%` }} transition={{ duration: reduce ? 0 : 0.9, ease: "easeOut" }} />
        </div>
        <div className="num mt-1.5 flex justify-between text-xs text-muted" aria-hidden><span>0%</span><span>20%</span><span>50%</span><span>100%</span></div>
      </div>

      {t && (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="panel-dim p-3">
            <dt className="text-xs text-muted">{t.uncertainty_range.method === "venn_abers" ? "Probability range (not a confidence interval)" : "Model range (not a confidence interval)"}</dt>
            <dd className="num font-semibold">{pct(t.uncertainty_range.low)} to {pct(t.uncertainty_range.high)}</dd>
          </div>
          <div className="panel-dim p-3">
            <dt className="text-xs text-muted">Two models agree</dt>
            <dd className="font-semibold"><span className="capitalize">{t.model_agreement.level}</span> <span className="num font-normal text-muted">({t.model_agreement.difference_pp.toFixed(0)} pts apart)</span></dd>
          </div>
          {a && (
            <div className="panel-dim col-span-2 p-3" data-testid="applicability">
              <dt className="text-xs text-muted">Is this model for people like you?</dt>
              <dd className="font-semibold">{a.level === "typical" ? "Yes, your inputs look typical" : a.level === "unusual" ? "Partly: your inputs are unusual" : "Probably not: your inputs are outside what it learned"}</dd>
              <dd className="mt-0.5 text-xs text-muted">Closer to the middle than {Math.round((1 - a.distance_percentile) * 100)}% of training people. {a.limit}</dd>
            </div>
          )}
          {t.conformal && (
            <div className="panel-dim col-span-2 p-3" data-testid="conformal">
              <dt className="text-xs text-muted">{Math.round(t.conformal.coverage * 100)}% reliability check</dt>
              <dd className="font-semibold">{t.conformal.verdict === "undecided" ? "Too close to call" : t.conformal.verdict === "higher" ? "Points to higher" : t.conformal.verdict === "lower" ? "Points to lower" : "Unusual inputs"}</dd>
              <dd className="mt-0.5 text-xs text-muted">{t.conformal.text} {t.conformal.guarantee}</dd>
            </div>
          )}
        </dl>
      )}
      {t && t.out_of_distribution.length > 0 && (
        <p role="note" className="mt-3 rounded-xl bg-moderate-bg p-3 text-sm text-moderate">
          Outside the training data range: {t.out_of_distribution.map((o) => `${o.feature} (${o.value})`).join(", ")}. Treat this estimate with extra caution.
        </p>
      )}

      <ExperimentalNote className="mt-4" />
      {p.limitations && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer font-medium text-brand">About this estimate</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{p.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        </details>
      )}
    </Glass>
  );
}
