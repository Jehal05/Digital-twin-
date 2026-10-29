import type { RiskBand } from "../api/types";

export const pct = (p: number, digits = 0) => `${(p * 100).toFixed(digits)}%`;
export const points = (effect: number) => `${effect >= 0 ? "+" : "−"}${Math.abs(effect * 100).toFixed(1)} pts`;

export const BAND_LABEL: Record<RiskBand, string> = { low: "Lower estimate", moderate: "Moderate estimate", high: "Higher estimate" };
export const BAND_TEXT: Record<RiskBand, string> = { low: "text-low", moderate: "text-moderate", high: "text-high" };
export const BAND_CHIP: Record<RiskBand, string> = { low: "bg-low-bg text-low", moderate: "bg-moderate-bg text-moderate", high: "bg-high-bg text-high" };

export const MEASUREMENT_LABEL: Record<string, string> = {
  weight_kg: "Weight", height_cm: "Height", bmi: "BMI", glucose_mgdl: "Glucose (fasting/random)", glucose_2h_mgdl: "Glucose (2-hour test)", bp_systolic: "Systolic BP",
  bp_diastolic: "Diastolic BP", cholesterol_mgdl: "Cholesterol", heart_rate_max: "Max heart rate", resting_hr: "Resting heart rate",
  steps: "Steps", sleep_hours: "Sleep",
};

/** Mirrors backend/app/services/measurements.py. The server stays the authority; this only drives the form. */
export const MEASUREMENT_UNITS: Record<string, string[]> = {
  weight_kg: ["kg", "lb"], height_cm: ["cm", "in", "m"], bmi: ["kg/m2"], glucose_mgdl: ["mg/dL", "mmol/L"], glucose_2h_mgdl: ["mg/dL", "mmol/L"],
  bp_systolic: ["mmHg"], bp_diastolic: ["mmHg"], cholesterol_mgdl: ["mg/dL", "mmol/L"], heart_rate_max: ["bpm"],
  resting_hr: ["bpm"], steps: ["count"], sleep_hours: ["h"],
};

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** Plain-language names and category words for model inputs, so people never see raw codes such as "Sex 0". */
const FEATURE_LABEL: Record<string, string> = {
  glucose: "2-hour glucose", bmi: "Body mass index", blood_pressure: "Diastolic blood pressure", age: "Age", pregnancies: "Pregnancies",
  sex: "Sex", cp: "Chest pain type", trestbps: "Resting systolic blood pressure", chol: "Serum cholesterol", fbs: "Fasting blood sugar above 120",
  restecg: "Resting ECG", thalach: "Max heart rate in stress test", exang: "Exercise-induced chest pain", oldpeak: "ST depression in stress test",
};
const CATEGORY_WORDS: Record<string, Record<number, string>> = {
  sex: { 1: "Male", 0: "Female" },
  cp: { 1: "Typical angina", 2: "Atypical angina", 3: "Non-anginal pain", 4: "No chest pain (asymptomatic)" },
  fbs: { 0: "No", 1: "Yes" },
  restecg: { 0: "Normal", 1: "ST-T wave abnormality", 2: "Left ventricular hypertrophy" },
  exang: { 0: "No", 1: "Yes" },
};
export const featureLabel = (feature: string, fallback = feature) => FEATURE_LABEL[feature] ?? fallback;
export function featureValue(feature: string, value: number, unit = ""): string {
  const word = CATEGORY_WORDS[feature]?.[value];
  return word ?? `${value}${unit ? " " + unit : ""}`;
}
export const isCategorical = (feature: string) => feature in CATEGORY_WORDS;
