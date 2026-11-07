/** On-device ("zero-upload") inference. The same arithmetic as the trained scikit-learn pipeline, from an exported JSON file. */
export interface NumericTerm { feature: string; kind: "numeric"; median: number; mean: number; scale: number; coef: number }
export interface CategoricalTerm { feature: string; kind: "categorical"; mode: number; categories: number[]; coefs: number[] }
export interface FieldSpec { label: string; unit: string; kind: "continuous" | "integer" | "binary" | "categorical"; min: number; max: number; categories: number[]; editable: boolean }
export interface DeviceModel {
  condition: string; version: string; algorithm: "logistic_regression"; intercept: number; calibration: { a: number; b: number };
  terms: (NumericTerm | CategoricalTerm)[]; features: string[]; risk_band_edges: [number, number]; schema: Record<string, FieldSpec>; note: string;
}
export interface DeviceDriver { feature: string; effect: number }
export interface DeviceResult { score: number; band: "low" | "moderate" | "high"; drivers: DeviceDriver[] }

const missing = (v: number | null | undefined): v is null | undefined => v === null || v === undefined || Number.isNaN(v);

/** Decision value f of the logistic regression, plus each input's additive part of it. */
function decision(m: DeviceModel, row: Record<string, number | null | undefined>): { z: number; parts: DeviceDriver[] } {
  let z = m.intercept;
  const parts: DeviceDriver[] = [];
  for (const t of m.terms) {
    const v = row[t.feature];
    let part = 0;
    if (t.kind === "numeric") {
      const x = missing(v) ? t.median : v;
      part = (t.coef * (x - t.mean)) / t.scale;
    } else {
      const x = missing(v) ? t.mode : v;
      const i = t.categories.indexOf(x);
      part = i >= 0 ? t.coefs[i] : 0;
    }
    z += part;
    parts.push({ feature: t.feature, effect: part });
  }
  return { z, parts };
}

export function predictOnDevice(m: DeviceModel, row: Record<string, number | null | undefined>): DeviceResult {
  const { z, parts } = decision(m, row);
  const score = 1 / (1 + Math.exp(m.calibration.a * z + m.calibration.b));
  const [lo, hi] = m.risk_band_edges;
  // Sign: calibrated p rises with z when a < 0, so a driver "raises" the estimate when its part has the sign of -a.
  const dir = m.calibration.a < 0 ? 1 : -1;
  const drivers = parts.map((d) => ({ feature: d.feature, effect: d.effect * dir })).sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect));
  return { score, band: score < lo ? "low" : score < hi ? "moderate" : "high", drivers };
}

/** Throws a readable message for anything the server would also reject (out of range, wrong category, not a number). */
export function validateOnDevice(m: DeviceModel, row: Record<string, string | number | undefined>): { values: Record<string, number>; errors: Record<string, string> } {
  const values: Record<string, number> = {}, errors: Record<string, string> = {};
  for (const f of m.features) {
    const s = m.schema[f], raw = row[f];
    if (raw === undefined || raw === "") { errors[f] = "required"; continue; }
    const v = Number(raw);
    if (!Number.isFinite(v)) { errors[f] = "must be a number"; continue; }
    if (s.kind === "binary" || s.kind === "categorical") {
      if (!(s.categories.length ? s.categories : [0, 1]).includes(v)) { errors[f] = "pick one of the options"; continue; }
    } else if (v < s.min || v > s.max) { errors[f] = `must be between ${s.min} and ${s.max}${s.unit ? ` ${s.unit}` : ""}`; continue; }
    if (s.kind === "integer" && v !== Math.trunc(v)) { errors[f] = "must be a whole number"; continue; }
    values[f] = v;
  }
  return { values, errors };
}

const cache = new Map<string, Promise<DeviceModel>>();
export function loadDeviceModel(condition: string): Promise<DeviceModel> {
  let p = cache.get(condition);
  if (!p) {
    p = fetch(`/models/${condition}.json`).then((r) => { if (!r.ok) throw new Error("model file unavailable"); return r.json() as Promise<DeviceModel>; });
    p.catch(() => cache.delete(condition));
    cache.set(condition, p);
  }
  return p;
}

/** For tests. */
export const clearDeviceModelCache = () => cache.clear();
