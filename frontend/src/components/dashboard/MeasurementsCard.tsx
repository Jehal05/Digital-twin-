import { Link } from "react-router-dom";
import type { DashboardData, TrendPoint } from "../../api/types";
import { MEASUREMENT_LABEL, shortDate } from "../../lib/format";
import { ContentTag } from "../ui/ContentTag";
import { CardTitle, Glass } from "../ui/Glass";
import { EmptyState } from "../ui/States";

export function Sparkline({ points, label }: { points: TrendPoint[]; label: string }) {
  if (points.length < 2) return <span className="text-xs text-muted">1 reading</span>;
  const vs = points.map((p) => p.value), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const xy = vs.map((v, i) => `${(i / (vs.length - 1)) * 76 + 2},${22 - ((v - lo) / span) * 18}`).join(" ");
  return (
    <svg role="img" aria-label={`${label}: ${vs.length} readings from ${vs[0]} to ${vs[vs.length - 1]}`} width="80" height="26" viewBox="0 0 80 26">
      <polyline points={xy} fill="none" stroke="#2a58c8" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function MeasurementsCard({ data }: { data: DashboardData }) {
  const rows = Object.values(data.latest_measurements);
  return (
    <Glass className="p-5" aria-labelledby="meas-title">
      <CardTitle aside={<ContentTag kind="measured" />}><span id="meas-title">Latest measurements</span></CardTitle>
      {data.flagged_count > 0 && (
        <p role="status" className="mb-3 rounded-xl bg-moderate-bg p-3 text-sm text-moderate">
          {data.flagged_count} reading{data.flagged_count > 1 ? "s" : ""} look unusual. <Link className="font-semibold underline" to="/profile">Review them</Link> before relying on estimates.
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState title="No measurements yet" action={<Link className="font-semibold text-brand underline" to="/profile">Add your first measurement</Link>}>
          Measurements you add are kept as a history, each with its source and date.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-white/70">
          {rows.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <p className="text-sm font-medium">{MEASUREMENT_LABEL[m.measurement_type] ?? m.measurement_type}</p>
                <p className="text-xs text-muted">{shortDate(m.recorded_at)} · {m.source}{m.validation_status === "flagged" ? " · needs review" : ""}</p>
              </div>
              <Sparkline points={data.trend_series[m.measurement_type] ?? []} label={MEASUREMENT_LABEL[m.measurement_type] ?? m.measurement_type} />
              <p className="num w-24 text-right text-lg font-semibold">{m.value}<span className="ml-1 text-xs font-normal text-muted">{m.unit}</span></p>
            </li>
          ))}
        </ul>
      )}
    </Glass>
  );
}
