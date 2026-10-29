import type { Prediction } from "../../api/types";
import { featureLabel, featureValue, isCategorical, points } from "../../lib/format";
import { CardTitle, Glass } from "../ui/Glass";
import { ContentTag } from "../ui/ContentTag";

export function WhyRisk({ p }: { p: Prediction }) {
  const drivers = p.explanation?.top_drivers ?? [];
  const max = Math.max(0.0001, ...drivers.map((d) => Math.abs(d.effect)));
  return (
    <Glass className="p-5" aria-labelledby="why-title">
      <CardTitle aside={<ContentTag kind="ai_estimate" />}><span id="why-title">Why this score?</span></CardTitle>
      {drivers.length === 0 ? (
        <p className="text-sm text-muted">No explanation was returned for this estimate.</p>
      ) : (
        <ul className="space-y-3">
          {drivers.map((d) => (
            <li key={d.feature} className="panel-dim p-3">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <p className="text-xs text-muted">{featureLabel(d.feature, d.label)}</p>
                  {isCategorical(d.feature) ? <p className="text-xl font-semibold">{featureValue(d.feature, d.value)}</p>
                    : <p className="num text-2xl font-semibold">{d.value}<span className="ml-1 text-sm font-normal text-muted">{d.unit}</span></p>}
                </div>
                <span className={`num rounded-full px-2.5 py-0.5 text-xs font-semibold ${d.direction === "raises" ? "bg-high-bg text-high" : "bg-low-bg text-low"}`}>
                  {d.direction === "raises" ? "▲" : "▼"} {points(d.effect)}
                </span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-card/70" aria-hidden>
                <div className={`h-1.5 rounded-full ${d.direction === "raises" ? "bg-[#e5534b]" : "bg-[#22b573]"}`} style={{ width: `${(Math.abs(d.effect) / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">
        Shown relative to a typical person in the training data, so a value can "lower" the estimate just by being below that average.
        This describes how the model behaves; it does not show what causes disease.
      </p>
    </Glass>
  );
}
