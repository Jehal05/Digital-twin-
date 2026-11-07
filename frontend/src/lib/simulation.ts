/** Virtual patient: a seeded, synthetic stream of daily readings. EVERYTHING produced here is simulated. No real person is involved
 *  and nothing is stored or sent. The anomaly rule below is the same rule the server applies to real readings
 *  (backend/app/services/measurements.py); a backend test checks that the two tables agree. */
export type SeriesKey = "glucose_2h_mgdl" | "bmi" | "bp_diastolic" | "bp_systolic" | "heart_rate_max" | "cholesterol_mgdl";

// Flag a reading that differs from the previous one (within 48 h) by more than this fraction.
export const JUMP: Record<SeriesKey, number> = { glucose_2h_mgdl: 0.6, bmi: 0.1, bp_diastolic: 0.4, bp_systolic: 0.4, heart_rate_max: 0.5, cholesterol_mgdl: 0.5 };
export const RANGE: Record<SeriesKey, [number, number]> = { glucose_2h_mgdl: [30, 600], bmi: [10, 80], bp_diastolic: [30, 160], bp_systolic: [50, 260], heart_rate_max: [60, 230], cholesterol_mgdl: [50, 700] };
export const SERIES_LABEL: Record<SeriesKey, string> = { glucose_2h_mgdl: "2-hour glucose (mg/dL)", bmi: "BMI", bp_diastolic: "Diastolic BP (mmHg)", bp_systolic: "Systolic BP (mmHg)", heart_rate_max: "Max heart rate (bpm)", cholesterol_mgdl: "Cholesterol (mg/dL)" };

interface SeriesSpec { base: number; driftPerDay: number; sd: number; weekly: number }
interface EventSpec { day: number; series: SeriesKey; factor: number; note: string }
export interface Persona {
  id: string; name: string; blurb: string;
  fixed: { age: number; sex: 0 | 1; pregnancies: number; cp: number; fbs: number; restecg: number; exang: number; oldpeak: number };
  series: Record<SeriesKey, SeriesSpec>; events: EventSpec[];
}

export const PERSONAS: Persona[] = [
  { id: "steady", name: "Steady and healthy", blurb: "Stable readings with normal day-to-day variation. One sensor glitch on day 30 to show anomaly detection.",
    fixed: { age: 34, sex: 0, pregnancies: 1, cp: 3, fbs: 0, restecg: 0, exang: 0, oldpeak: 0.2 },
    series: { glucose_2h_mgdl: { base: 105, driftPerDay: 0, sd: 7, weekly: 3 }, bmi: { base: 23.1, driftPerDay: 0, sd: 0.15, weekly: 0 }, bp_diastolic: { base: 72, driftPerDay: 0, sd: 3, weekly: 1.5 },
      bp_systolic: { base: 118, driftPerDay: 0, sd: 4, weekly: 2 }, heart_rate_max: { base: 172, driftPerDay: 0, sd: 3, weekly: 0 }, cholesterol_mgdl: { base: 180, driftPerDay: 0, sd: 5, weekly: 0 } },
    events: [{ day: 30, series: "glucose_2h_mgdl", factor: 1.9, note: "sensor glitch" }] },
  { id: "drift", name: "Slow upward drift", blurb: "Weight, glucose and blood pressure creep up over three months, as they can with a gradual lifestyle change.",
    fixed: { age: 52, sex: 1, pregnancies: 0, cp: 2, fbs: 0, restecg: 0, exang: 0, oldpeak: 0.8 },
    series: { glucose_2h_mgdl: { base: 118, driftPerDay: 0.55, sd: 8, weekly: 4 }, bmi: { base: 27.5, driftPerDay: 0.03, sd: 0.2, weekly: 0 }, bp_diastolic: { base: 80, driftPerDay: 0.1, sd: 3, weekly: 2 },
      bp_systolic: { base: 130, driftPerDay: 0.2, sd: 5, weekly: 2 }, heart_rate_max: { base: 150, driftPerDay: -0.05, sd: 4, weekly: 0 }, cholesterol_mgdl: { base: 215, driftPerDay: 0.3, sd: 6, weekly: 0 } },
    events: [{ day: 55, series: "bmi", factor: 1.2, note: "scale error" }] },
  { id: "recovery", name: "Improving habits", blurb: "Starts with raised readings that fall steadily, as a model of someone changing their routine.",
    fixed: { age: 47, sex: 1, pregnancies: 0, cp: 4, fbs: 1, restecg: 1, exang: 0, oldpeak: 1.2 },
    series: { glucose_2h_mgdl: { base: 165, driftPerDay: -0.6, sd: 9, weekly: 4 }, bmi: { base: 32.5, driftPerDay: -0.04, sd: 0.2, weekly: 0 }, bp_diastolic: { base: 92, driftPerDay: -0.12, sd: 3, weekly: 2 },
      bp_systolic: { base: 146, driftPerDay: -0.22, sd: 5, weekly: 2 }, heart_rate_max: { base: 148, driftPerDay: 0.08, sd: 4, weekly: 0 }, cholesterol_mgdl: { base: 255, driftPerDay: -0.5, sd: 7, weekly: 0 } },
    events: [{ day: 12, series: "glucose_2h_mgdl", factor: 0.4, note: "sensor dropout" }, { day: 70, series: "bp_systolic", factor: 1.6, note: "cuff misread" }] },
];

/** Small seeded generator (mulberry32) so a persona + seed always produces the same patient. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());

export interface Reading { day: number; series: SeriesKey; value: number; flagged: boolean; reason: string | null; planted: string | null }

export function anomalyReason(series: SeriesKey, value: number, prev: number | null): string | null {
  if (prev === null || prev === 0) return null;
  const change = Math.abs(value - prev) / Math.abs(prev);
  return change > JUMP[series] ? `jump vs previous: ${Math.round(change * 100)}% change from ${prev.toFixed(1)}` : null;
}

/** Generates `days` of daily readings for every series. The AR(1) noise gives realistic day-to-day persistence. */
export function generate(persona: Persona, days: number, seed = 7): Reading[] {
  const r = rng(seed ^ persona.id.length * 977);
  const out: Reading[] = [];
  const last: Partial<Record<SeriesKey, number>> = {};
  const noise: Partial<Record<SeriesKey, number>> = {};
  for (let day = 0; day <= days; day++) {
    for (const key of Object.keys(persona.series) as SeriesKey[]) {
      const s = persona.series[key];
      noise[key] = 0.6 * (noise[key] ?? 0) + Math.sqrt(1 - 0.36) * gauss(r) * s.sd;
      let v = s.base + s.driftPerDay * day + (s.weekly ? s.weekly * Math.sin((2 * Math.PI * day) / 7) : 0) + noise[key]!;
      const ev = persona.events.find((e) => e.day === day && e.series === key);
      if (ev) v *= ev.factor;
      const [lo, hi] = RANGE[key];
      v = Math.round(Math.min(hi, Math.max(lo, v)) * 10) / 10;
      const reason = anomalyReason(key, v, last[key] ?? null);
      out.push({ day, series: key, value: v, flagged: reason !== null, reason, planted: ev ? ev.note : null });
      last[key] = v;
    }
  }
  return out;
}

/** The model inputs on a given day, built from that day's simulated readings (the server maps readings to inputs the same way). */
export function inputsOn(persona: Persona, readings: Reading[], day: number) {
  const at = (k: SeriesKey) => readings.find((x) => x.day === day && x.series === k)!.value;
  const f = persona.fixed;
  return {
    diabetes: { pregnancies: f.pregnancies, glucose: at("glucose_2h_mgdl"), blood_pressure: at("bp_diastolic"), bmi: at("bmi"), age: f.age } as Record<string, number>,
    heart_disease: { age: f.age, sex: f.sex, cp: f.cp, trestbps: at("bp_systolic"), chol: at("cholesterol_mgdl"), fbs: f.fbs, restecg: f.restecg,
      thalach: at("heart_rate_max"), exang: f.exang, oldpeak: f.oldpeak } as Record<string, number>,
  };
}
