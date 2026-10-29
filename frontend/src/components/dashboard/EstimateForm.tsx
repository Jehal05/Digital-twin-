import { useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../../api/client";
import type { DashboardData, Prediction } from "../../api/types";
import { shortDate } from "../../lib/format";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";

/** Client-side hints only. The server validates every value against the model's real schema. */
export const DIABETES_FIELDS = [
  { name: "pregnancies", label: "Number of pregnancies", unit: "", min: 0, max: 20, step: 1, hint: "Enter 0 if none or not applicable." },
  { name: "glucose", label: "2-hour plasma glucose", unit: "mg/dL", min: 40, max: 400, step: 1,
    hint: "From an oral glucose tolerance test. The model was trained on that measurement, so a fasting or random reading is not equivalent." },
  { name: "blood_pressure", label: "Diastolic blood pressure", unit: "mmHg", min: 30, max: 130, step: 1, hint: "The lower number of a blood pressure reading." },
  { name: "bmi", label: "Body mass index", unit: "kg/m²", min: 12, max: 70, step: 0.1, hint: "" },
  { name: "age", label: "Age", unit: "years", min: 18, max: 100, step: 1, hint: "" },
] as const;

export function prefill(data: DashboardData | null): { values: Record<string, string>; sources: Record<string, string> } {
  const values: Record<string, string> = {}, sources: Record<string, string> = {};
  if (!data) return { values, sources };
  const m = data.latest_measurements;
  const take = (field: string, v: number | undefined, src: string) => { if (v !== undefined) { values[field] = String(v); sources[field] = src; } };
  if (m.glucose_mgdl) take("glucose", m.glucose_mgdl.value, `from your ${shortDate(m.glucose_mgdl.recorded_at)} measurement`);
  if (m.bp_diastolic) take("blood_pressure", m.bp_diastolic.value, `from your ${shortDate(m.bp_diastolic.recorded_at)} measurement`);
  if (m.bmi) take("bmi", m.bmi.value, `from your ${shortDate(m.bmi.recorded_at)} measurement`);
  else if (data.profile.bmi) take("bmi", data.profile.bmi.value, data.profile.bmi.source);
  if (data.profile.age !== null) take("age", data.profile.age, "from your profile");
  return { values, sources };
}

export function EstimateForm({ data, onDone, onCancel }: { data: DashboardData | null; onDone(p: Prediction): void; onCancel(): void }) {
  const initial = useMemo(() => prefill(data), [data]);
  const [values, setValues] = useState<Record<string, string>>(initial.values);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    const features: Record<string, number> = {};
    for (const f of DIABETES_FIELDS) {
      const raw = (values[f.name] ?? "").trim();
      const n = Number(raw);
      if (raw === "" || Number.isNaN(n)) next[f.name] = "Enter a number";
      else if (n < f.min || n > f.max) next[f.name] = `Must be between ${f.min} and ${f.max}${f.unit ? " " + f.unit : ""}`;
      else features[f.name] = n;
    }
    setErrors(next); setFormError("");
    if (Object.keys(next).length) return;
    setBusy(true);
    try { onDone(await api.post<Prediction>("/predictions/diabetes", { features })); }
    catch (err) {
      if (err instanceof ApiError) { setErrors(err.fields); setFormError(err.message); } else setFormError("Something went wrong.");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Diabetes estimate inputs">
      <p className="rounded-xl bg-brand-soft p-3 text-sm">
        This model was trained on women aged 21 to 81 of Pima Indian heritage. If that isn't you, treat the result as a demonstration of how the model reacts to numbers, not as information about you.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {DIABETES_FIELDS.map((f) => (
          <Field key={f.name} label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`} type="number" inputMode="decimal" step={f.step} min={f.min} max={f.max}
            value={values[f.name] ?? ""} error={errors[f.name]}
            hint={[f.hint, initial.sources[f.name] && `Prefilled ${initial.sources[f.name]}.`].filter(Boolean).join(" ")}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
        ))}
      </div>
      {formError && <p role="alert" className="text-sm font-medium text-high">{formError}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "Calculating…" : "Get estimate"}</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}
