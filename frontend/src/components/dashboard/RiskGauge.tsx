import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useEffect } from "react";
import type { Prediction } from "../../api/types";
import { BAND_CHIP, BAND_LABEL, pct, timeAgo } from "../../lib/format";
import { CardTitle, Glass } from "../ui/Glass";
import { ContentTag, ExperimentalNote } from "../ui/ContentTag";

const TITLE = { diabetes: "Diabetes estimate", heart_disease: "Heart disease estimate" } as const;

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
  return (
    <Glass className="p-5" aria-labelledby="gauge-title">
      <CardTitle aside={<div className="flex items-center gap-2"><ContentTag kind="ai_estimate" /><span className={`rounded-full px-3 py-0.5 text-xs font-semibold ${BAND_CHIP[p.risk_band]}`}>{BAND_LABEL[p.risk_band]}</span></div>}>
        <span id="gauge-title">{TITLE[p.condition]}</span>
      </CardTitle>

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
            <dt className="text-xs text-muted">Model range (not a confidence interval)</dt>
            <dd className="num font-semibold">{pct(t.uncertainty_range.low)} to {pct(t.uncertainty_range.high)}</dd>
          </div>
          <div className="panel-dim p-3">
            <dt className="text-xs text-muted">Two models agree</dt>
            <dd className="font-semibold"><span className="capitalize">{t.model_agreement.level}</span> <span className="num font-normal text-muted">({t.model_agreement.difference_pp.toFixed(0)} pts apart)</span></dd>
          </div>
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
