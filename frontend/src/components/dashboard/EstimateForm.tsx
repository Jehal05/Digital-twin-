import { useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../../api/client";
import type { Condition, DashboardData, Prediction } from "../../api/types";
import { shortDate } from "../../lib/format";
import { Button } from "../ui/Button";
import { Field, SelectField } from "../ui/Field";

/** Client-side hints only. The server validates every value against the model's real schema. */
export const DIABETES_FIELDS = [
  { name: "pregnancies", label: "Number of pregnancies", unit: "", min: 0, max: 20, step: 1, hint: "Enter 0 if none or not applicable." },
  { name: "glucose", label: "2-hour plasma glucose", unit: "mg/dL", min: 40, max: 400, step: 1,
    hint: "From an oral glucose tolerance test. The model was trained on that measurement, so a fasting or random reading is not equivalent." },
  { name: "blood_pressure", label: "Diastolic blood pressure", unit: "mmHg", min: 30, max: 130, step: 1, hint: "The lower number of a blood pressure reading." },
  { name: "bmi", label: "Body mass index", unit: "kg/m²", min: 12, max: 70, step: 0.1, hint: "" },
  { name: "age", label: "Age", unit: "years", min: 18, max: 100, step: 1, hint: "" },
] as const;

type Opt = readonly [string, string];
export interface HeartField { name: string; label: string; unit: string; min: number; max: number; step: number; hint: string; options?: readonly Opt[] }
/** Ranges mirror ml/artifacts/heart_disease feature_schema.json; the server validates again. */
export const HEART_FIELDS: readonly HeartField[] = [
  { name: "age", label: "Age", unit: "years", min: 18, max: 100, step: 1, hint: "" },
  { name: "sex", label: "Sex", unit: "", min: 0, max: 1, step: 1, hint: "The model was trained with male or female only.", options: [["1", "Male"], ["0", "Female"]] },
  { name: "cp", label: "Chest pain type", unit: "", min: 1, max: 4, step: 1, hint: "", options: [["1", "Typical angina"], ["2", "Atypical angina"], ["3", "Non-anginal pain"], ["4", "No chest pain (asymptomatic)"]] },
  { name: "trestbps", label: "Resting systolic blood pressure", unit: "mmHg", min: 70, max: 250, step: 1, hint: "The upper number of a blood pressure reading." },
  { name: "chol", label: "Serum cholesterol", unit: "mg/dL", min: 100, max: 600, step: 1, hint: "Total cholesterol." },
  { name: "fbs", label: "Fasting blood sugar above 120 mg/dL", unit: "", min: 0, max: 1, step: 1, hint: "", options: [["0", "No"], ["1", "Yes"]] },
  { name: "restecg", label: "Resting ECG result", unit: "", min: 0, max: 2, step: 1, hint: "From a clinic ECG report.", options: [["0", "Normal"], ["1", "ST-T wave abnormality"], ["2", "Left ventricular hypertrophy"]] },
  { name: "thalach", label: "Maximum heart rate in a stress test", unit: "bpm", min: 60, max: 220, step: 1, hint: "From an exercise stress test. A resting or watch reading is not equivalent." },
  { name: "exang", label: "Chest pain brought on by exercise", unit: "", min: 0, max: 1, step: 1, hint: "", options: [["0", "No"], ["1", "Yes"]] },
  { name: "oldpeak", label: "ST depression during exercise", unit: "mm", min: 0, max: 7, step: 0.1, hint: "From a stress-test ECG report." },
];

/** Mirrors ml/artifacts/diabetes_survey feature_schema.json; the server validates again. */
export const SURVEY_FIELDS: readonly HeartField[] = [
  { name: "age_band", label: "Age group", unit: "", min: 1, max: 13, step: 1, hint: "", options: [["1","18 to 24"],["2","25 to 29"],["3","30 to 34"],["4","35 to 39"],["5","40 to 44"],["6","45 to 49"],["7","50 to 54"],["8","55 to 59"],["9","60 to 64"],["10","65 to 69"],["11","70 to 74"],["12","75 to 79"],["13","80 or older"]] },
  { name: "sex", label: "Sex", unit: "", min: 0, max: 1, step: 1, hint: "The model was trained with male or female only.", options: [["1", "Male"], ["0", "Female"]] },
  { name: "bmi", label: "Body mass index", unit: "kg/m²", min: 12, max: 70, step: 0.1, hint: "" },
  { name: "high_bp", label: "Ever told you have high blood pressure", unit: "", min: 0, max: 1, step: 1, hint: "", options: [["0", "No"], ["1", "Yes"]] },
  { name: "high_chol", label: "Ever told you have high cholesterol", unit: "", min: 0, max: 1, step: 1, hint: "", options: [["0", "No"], ["1", "Yes"]] },
  { name: "stroke", label: "Ever told you had a stroke", unit: "", min: 0, max: 1, step: 1, hint: "", options: [["0", "No"], ["1", "Yes"]] },
  { name: "heart_disease_or_attack", label: "Ever told you had coronary heart disease or a heart attack", unit: "", min: 0, max: 1, step: 1, hint: "", options: [["0", "No"], ["1", "Yes"]] },
  { name: "smoker", label: "Smoked at least 100 cigarettes in your life", unit: "", min: 0, max: 1, step: 1, hint: "", options: [["0", "No"], ["1", "Yes"]] },
  { name: "physical_activity", label: "Any physical activity in the past 30 days (outside work)", unit: "", min: 0, max: 1, step: 1, hint: "", options: [["0", "No"], ["1", "Yes"]] },
  { name: "fruit_daily", label: "Eat fruit at least once a day", unit: "", min: 0, max: 1, step: 1, hint: "", options: [["0", "No"], ["1", "Yes"]] },
  { name: "veg_daily", label: "Eat vegetables at least once a day", unit: "", min: 0, max: 1, step: 1, hint: "", options: [["0", "No"], ["1", "Yes"]] },
  { name: "heavy_alcohol", label: "Heavy drinker (men over 14, women over 7 drinks a week)", unit: "", min: 0, max: 1, step: 1, hint: "", options: [["0", "No"], ["1", "Yes"]] },
  { name: "general_health", label: "General health", unit: "", min: 1, max: 5, step: 1, hint: "", options: [["1","Excellent"],["2","Very good"],["3","Good"],["4","Fair"],["5","Poor"]] },
  { name: "mental_health_days", label: "Days of poor mental health in the past 30", unit: "days", min: 0, max: 30, step: 1, hint: "" },
  { name: "physical_health_days", label: "Days of poor physical health in the past 30", unit: "days", min: 0, max: 30, step: 1, hint: "" },
  { name: "difficulty_walking", label: "Serious difficulty walking or climbing stairs", unit: "", min: 0, max: 1, step: 1, hint: "", options: [["0", "No"], ["1", "Yes"]] },
];

export function prefillHeart(data: DashboardData | null): { values: Record<string, string>; sources: Record<string, string> } {
  const values: Record<string, string> = {}, sources: Record<string, string> = {};
  if (!data) return { values, sources };
  const m = data.latest_measurements;
  const take = (field: string, v: number, src: string) => { values[field] = String(v); sources[field] = src; };
  if (m.bp_systolic) take("trestbps", m.bp_systolic.value, `from your ${shortDate(m.bp_systolic.recorded_at)} measurement`);
  if (m.cholesterol_mgdl) take("chol", m.cholesterol_mgdl.value, `from your ${shortDate(m.cholesterol_mgdl.recorded_at)} measurement`);
  if (data.profile.age !== null) take("age", data.profile.age, "from your profile");
  if (data.profile.sex === "male") take("sex", 1, "from your profile");
  if (data.profile.sex === "female") take("sex", 0, "from your profile");
  return { values, sources };
}

export function prefillSurvey(data: DashboardData | null): { values: Record<string, string>; sources: Record<string, string> } {
  const values: Record<string, string> = {}, sources: Record<string, string> = {};
  if (!data) return { values, sources };
  const m = data.latest_measurements;
  if (m.bmi) { values.bmi = String(m.bmi.value); sources.bmi = `from your ${shortDate(m.bmi.recorded_at)} measurement`; }
  else if (data.profile.bmi) { values.bmi = String(data.profile.bmi.value); sources.bmi = data.profile.bmi.source; }
  if (data.profile.age !== null) {
    const a = data.profile.age;
    values.age_band = String(a < 25 ? 1 : a >= 80 ? 13 : Math.floor((a - 25) / 5) + 2); sources.age_band = "from your profile";
  }
  if (data.profile.sex === "male") { values.sex = "1"; sources.sex = "from your profile"; }
  if (data.profile.sex === "female") { values.sex = "0"; sources.sex = "from your profile"; }
  return { values, sources };
}

export function prefill(data: DashboardData | null): { values: Record<string, string>; sources: Record<string, string> } {
  const values: Record<string, string> = {}, sources: Record<string, string> = {};
  if (!data) return { values, sources };
  const m = data.latest_measurements;
  const take = (field: string, v: number | undefined, src: string) => { if (v !== undefined) { values[field] = String(v); sources[field] = src; } };
  if (m.glucose_2h_mgdl) take("glucose", m.glucose_2h_mgdl.value, `from your ${shortDate(m.glucose_2h_mgdl.recorded_at)} 2-hour test`);
  if (m.bp_diastolic) take("blood_pressure", m.bp_diastolic.value, `from your ${shortDate(m.bp_diastolic.recorded_at)} measurement`);
  if (m.bmi) take("bmi", m.bmi.value, `from your ${shortDate(m.bmi.recorded_at)} measurement`);
  else if (data.profile.bmi) take("bmi", data.profile.bmi.value, data.profile.bmi.source);
  if (data.profile.age !== null) take("age", data.profile.age, "from your profile");
  return { values, sources };
}

export function EstimateForm({ data, onDone, onCancel, condition = "diabetes" }: { data: DashboardData | null; onDone(p: Prediction): void; onCancel(): void; condition?: Condition }) {
  const heart = condition === "heart_disease";
  const survey = condition === "diabetes_survey";
  const fields: readonly HeartField[] = heart ? HEART_FIELDS : survey ? SURVEY_FIELDS : DIABETES_FIELDS;
  const initial = useMemo(() => (heart ? prefillHeart(data) : survey ? prefillSurvey(data) : prefill(data)), [data, heart, survey]);
  const [values, setValues] = useState<Record<string, string>>(initial.values);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    const features: Record<string, number> = {};
    for (const f of fields) {
      const raw = (values[f.name] ?? "").trim();
      const n = Number(raw);
      if (raw === "" || Number.isNaN(n)) next[f.name] = f.options ? "Choose an option" : "Enter a number";
      else if (n < f.min || n > f.max) next[f.name] = `Must be between ${f.min} and ${f.max}${f.unit ? " " + f.unit : ""}`;
      else features[f.name] = n;
    }
    setErrors(next); setFormError("");
    if (Object.keys(next).length) return;
    setBusy(true);
    try { onDone(await api.post<Prediction>(heart ? "/predictions/heart-disease" : survey ? "/predictions/diabetes-survey" : "/predictions/diabetes", { features })); }
    catch (err) {
      if (err instanceof ApiError) { setErrors(err.fields); setFormError(err.message); } else setFormError("Something went wrong.");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label={heart ? "Heart disease estimate inputs" : survey ? "Diabetes lifestyle survey estimate inputs" : "Diabetes estimate inputs"}>
      {survey ? (
        <p className="rounded-xl bg-brand-soft p-3 text-sm">
          This model was trained on about 253,000 US adults who answered a 2015 health survey. It needs no lab test, and it estimates how likely someone with your answers is to report a diabetes diagnosis. It cannot find undiagnosed diabetes and is not validated outside the US.
        </p>
      ) : heart ? (
        <p className="rounded-xl bg-brand-soft p-3 text-sm">
          This model was trained on 920 people referred for a heart angiogram at four hospitals (USA, Hungary, Switzerland). It estimates whether narrowing of heart arteries is found at testing, not your future risk. Several inputs (stress-test heart rate, ST depression, ECG) come from clinic tests; leave this form if you don't have them.
        </p>
      ) : (
      <p className="rounded-xl bg-brand-soft p-3 text-sm">
        This model was trained on women aged 21 to 81 of Pima Indian heritage. If that isn't you, treat the result as a demonstration of how the model reacts to numbers, not as information about you.
      </p>)}
      {!heart && !survey && data?.latest_measurements.glucose_mgdl && !data.latest_measurements.glucose_2h_mgdl && (
        <p className="rounded-xl bg-moderate-bg p-3 text-sm text-moderate" role="note">
          You have a fasting or random glucose reading, but this model needs a 2-hour glucose tolerance test value, so your reading was not used. Enter a 2-hour value if you have one.
        </p>)}
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => f.options ? (
          <SelectField key={f.name} label={f.label} value={values[f.name] ?? ""} error={errors[f.name]}
            hint={[f.hint, initial.sources[f.name] && `Prefilled ${initial.sources[f.name]}.`].filter(Boolean).join(" ")}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}>
            <option value="">Select…</option>
            {f.options.map(([val, text]) => <option key={val} value={val}>{text}</option>)}
          </SelectField>
        ) : (
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
