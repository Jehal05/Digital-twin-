import type { Condition, Prediction } from "../../api/types";
import { ContentTag } from "../ui/ContentTag";
import { CardTitle, Glass } from "../ui/Glass";

const OUTCOME: Record<Condition, string> = {
  diabetes: "had diabetes in the study data (Pima Indian women)",
  heart_disease: "had narrowed heart arteries on an angiogram (patients referred for that test)",
  diabetes_survey: "reported a diabetes diagnosis in the 2015 US health survey",
};

/** "100 people like you": the model's estimate as a 10 x 10 grid. Shape (not colour alone) separates the three kinds. */
export function IconArray({ p }: { p: Prediction }) {
  const n = Math.round(p.score * 100);
  const r = p.trust?.uncertainty_range;
  const lo = r ? Math.min(n, Math.round(r.low * 100)) : n, hi = r ? Math.max(n, Math.round(r.high * 100)) : n;
  const kind = (i: number) => (i < lo ? "yes" : i < hi ? "maybe" : "no");
  const summary = `Out of 100 people with answers like yours, the model estimates about ${n} ${OUTCOME[p.condition]}. The range is ${lo} to ${hi} out of 100.`;
  return (
    <Glass className="p-5" aria-label="100 people like you">
      <CardTitle aside={<ContentTag kind="ai_estimate" />}>100 people like you</CardTitle>
      <svg viewBox="0 0 200 200" role="img" aria-label={summary} className="mx-auto h-auto w-full max-w-xs" data-testid="icon-array">
        {Array.from({ length: 100 }, (_, i) => {
          const k = kind(i), cx = 10 + (i % 10) * 20, cy = 10 + Math.floor(i / 10) * 20;
          return k === "yes" ? <circle key={i} cx={cx} cy={cy} r="7" className="fill-brand" data-kind="yes" />
            : k === "maybe" ? <circle key={i} cx={cx} cy={cy} r="6" className="fill-none stroke-brand" strokeWidth="2" strokeDasharray="3 2" data-kind="maybe" />
            : <circle key={i} cx={cx} cy={cy} r="2.5" className="fill-field" data-kind="no" />;
        })}
      </svg>
      <ul className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs">
        <li><span aria-hidden>● </span>about {lo}: the model's estimate</li>
        {hi > lo && <li><span aria-hidden>◌ </span>up to {hi - lo} more within its probability range</li>}
        <li><span aria-hidden>· </span>the rest: not</li>
      </ul>
      <p className="mt-2 text-sm text-muted">{summary} It describes the training group, not a prediction about one person. Experimental model estimate, not a diagnosis.</p>
    </Glass>
  );
}
