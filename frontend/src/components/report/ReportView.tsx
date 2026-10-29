import type { Report } from "../../api/types";
import { BAND_CHIP, BAND_LABEL, MEASUREMENT_LABEL, pct, points, shortDate } from "../../lib/format";
import { ContentTag } from "../ui/ContentTag";
import { CardTitle, Glass } from "../ui/Glass";

export function ReportView({ r }: { r: Report }) {
  return (
    <div className="space-y-4">
      <Glass className="p-5"><h1 className="text-2xl font-bold tracking-tight">Health summary for a visit</h1>
        <p className="mt-1 text-sm text-muted">Generated {new Date(r.generated_at).toLocaleString()}{r.expires_at ? ` · link valid until ${new Date(r.expires_at).toLocaleDateString()}` : ""}</p>
        <p className="mt-2 rounded-xl bg-moderate-bg p-3 text-sm font-medium text-moderate">{r.disclaimer}</p></Glass>
      {r.profile && (
        <Glass className="p-5" aria-label="Profile"><CardTitle aside={<ContentTag kind="measured" />}>Profile</CardTitle>
          <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
            <div><dt className="inline text-muted">Age </dt><dd className="num inline font-semibold">{r.profile.age ?? "—"}</dd></div>
            <div><dt className="inline text-muted">Sex </dt><dd className="inline font-semibold capitalize">{r.profile.sex ?? "—"}</dd></div>
            <div><dt className="inline text-muted">Height </dt><dd className="num inline font-semibold">{r.profile.height_cm ? `${r.profile.height_cm} cm` : "—"}</dd></div>
          </dl></Glass>)}
      {r.measurements && (
        <Glass className="p-5" aria-label="Measurements"><CardTitle aside={<ContentTag kind="measured" />}>Readings, last {r.measurement_window_days} days</CardTitle>
          {r.measurements.length === 0 ? <p className="text-sm text-muted">No confirmed readings in this period.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-xs text-muted"><th className="py-1">Reading</th><th>Latest</th><th>Range</th><th>Count</th><th>Source</th></tr></thead>
              <tbody>{r.measurements.map((m) => (<tr key={m.measurement_type} className="border-t border-[#c9d5ee]"><td className="py-1.5 font-medium">{MEASUREMENT_LABEL[m.measurement_type] ?? m.measurement_type}</td>
                <td className="num">{m.latest} {m.unit} <span className="text-xs text-muted">({shortDate(m.latest_at)})</span></td><td className="num">{m.min} to {m.max}</td><td className="num">{m.count}</td><td className="text-xs">{m.sources.join(", ")}</td></tr>))}</tbody></table></div>)}
          <p className="mt-2 text-xs text-muted">Readings flagged as unusual and not yet confirmed are left out.</p></Glass>)}
      {r.estimates && (
        <Glass className="p-5" aria-label="Estimates"><CardTitle aside={<ContentTag kind="ai_estimate" />}>Model estimates</CardTitle>
          {r.estimates.length === 0 ? <p className="text-sm text-muted">No estimates have been run.</p> : (
            <ul className="space-y-4">{r.estimates.map((e) => (
              <li key={e.condition} className="panel-dim p-4"><div className="flex flex-wrap items-center gap-3"><h3 className="font-semibold">{e.condition === "diabetes" ? "Diabetes" : "Heart disease"} model</h3>
                <span className="num text-2xl font-bold">{pct(e.score, 1)}</span><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BAND_CHIP[e.risk_band]}`}>{BAND_LABEL[e.risk_band]}</span>
                <span className="text-xs text-muted">{shortDate(e.created_at)}</span></div>
                {e.model_range.low !== undefined && e.model_range.high !== undefined && <p className="num mt-1 text-sm">Model range {pct(e.model_range.low)} to {pct(e.model_range.high)} (variability, not a confidence interval)</p>}
                <p className="mt-1 text-xs text-muted">Inputs: {Object.entries(e.inputs).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
                {e.top_drivers.length > 0 && <p className="mt-1 text-sm">Main influences: {e.top_drivers.map((d) => `${d.label} (${d.direction} ${points(d.effect)})`).join("; ")}</p>}
                <p className="mt-2 text-xs text-muted">{e.limitations.slice(0, 2).join(" ")}</p></li>))}</ul>)}
          <p className="mt-3 text-sm font-medium">Experimental model estimate, not a diagnosis.</p></Glass>)}
    </div>
  );
}
