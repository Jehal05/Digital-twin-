import type { ContentKind } from "../../api/types";

const STYLE: Record<ContentKind, { label: string; cls: string; hint: string }> = {
  measured: { label: "Measured", cls: "bg-ink text-white", hint: "A value that was recorded (entered or imported)." },
  ai_estimate: { label: "AI estimate", cls: "bg-brand text-white", hint: "Output of a trained model on real inputs." },
  hypothetical: { label: "Hypothetical", cls: "hatched border border-dashed border-brand text-brand bg-white/60", hint: "A what-if scenario or projection, not a real result." },
  cohort_comparison: { label: "Cohort comparison", cls: "bg-brand-soft text-ink", hint: "Position within the study's training cohort only." },
};

/** The three kinds of content (measured, AI estimate, hypothetical) are tagged the same way everywhere. */
export function ContentTag({ kind }: { kind: ContentKind }) {
  const s = STYLE[kind];
  return (
    <span title={s.hint} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>
      {s.label}
    </span>
  );
}

/** Must sit near every risk number. */
export function ExperimentalNote({ className = "" }: { className?: string }) {
  return <p className={`text-xs text-muted ${className}`}>Experimental model estimate, not a diagnosis.</p>;
}
