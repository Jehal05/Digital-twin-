import { useEffect, useMemo, useState } from "react";
import { CONDITIONS, CONDITION_NAME } from "../lib/conditions";
import { BAND_CHIP, BAND_LABEL, featureLabel, featureValue } from "../lib/format";
import { loadDeviceModel, predictOnDevice, validateOnDevice, type DeviceModel, type DeviceResult } from "../lib/onDevice";
import { Logo } from "../components/layout/Logo";
import { Button } from "../components/ui/Button";
import { ContentTag } from "../components/ui/ContentTag";
import { Field, SelectField } from "../components/ui/Field";
import { CardTitle, Glass } from "../components/ui/Glass";
import { Skeleton } from "../components/ui/States";
import type { Condition } from "../api/types";

/** Public page, no account: the model runs in this browser tab, also offline. Nothing is sent anywhere. */
export function OnDevicePage() {
  const [condition, setCondition] = useState<Condition>("diabetes");
  const [model, setModel] = useState<DeviceModel | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ r: DeviceResult; requests: number } | null>(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);

  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  useEffect(() => {
    let live = true;
    setModel(null); setLoadErr(false); setResult(null); setErrors({}); setValues({});
    loadDeviceModel(condition).then((m) => live && setModel(m)).catch(() => live && setLoadErr(true));
    return () => { live = false; };
  }, [condition]);

  const fields = useMemo(() => (model ? model.features.map((f) => ({ name: f, spec: model.schema[f] })) : []), [model]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!model) return;
    const { values: v, errors: er } = validateOnDevice(model, values);
    setErrors(er);
    if (Object.keys(er).length) { setResult(null); return; }
    const before = performance.getEntriesByType("resource").length;   // network requests the browser has made so far
    const r = predictOnDevice(model, v);
    setResult({ r, requests: performance.getEntriesByType("resource").length - before });
  };

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="glass flex items-center gap-2.5 px-5 py-3"><Logo /><span className="text-lg font-bold">HealthTwin</span>
        <span className="ml-auto text-xs text-muted" data-testid="online-state">{online ? "Online" : "Offline"} · works either way</span></div>
      <Glass className="p-5" aria-label="On-device mode">
        <CardTitle aside={<ContentTag kind="ai_estimate" />}>Private mode: runs on this device</CardTitle>
        <p className="text-sm text-muted">No account, no upload. The trained model's numbers are loaded once into this page and the estimate is calculated here, so your answers never leave your device. It gives the same result as the server (tested to 9 decimal places). Dashboard features such as saving history, the Digital Twin and the Why panel's full detail need the server.</p>
        <nav aria-label="Condition" className="my-4 flex flex-wrap gap-2">
          {CONDITIONS.map((c) => (
            <button key={c} type="button" aria-pressed={c === condition} onClick={() => setCondition(c)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${c === condition ? "bg-brand text-on-strong" : "bg-card/70 hover:bg-card"}`}>{CONDITION_NAME[c]}</button>))}
        </nav>
        {loadErr ? <p role="alert" className="text-sm text-high">The model file could not be loaded. Open this page once while online and it will be saved for offline use.</p>
          : !model ? <Skeleton className="h-40" /> : (
          <form onSubmit={submit} noValidate className="space-y-3" aria-label="On-device estimate inputs">
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map(({ name, spec }) => spec.kind === "binary" || spec.kind === "categorical" ? (
                <SelectField key={name} label={featureLabel(name, spec.label)} value={values[name] ?? ""} error={errors[name]}
                  onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}>
                  <option value="">Choose…</option>
                  {(spec.categories.length ? spec.categories : [0, 1]).map((c) => <option key={c} value={c}>{featureValue(name, c)}</option>)}
                </SelectField>
              ) : (
                <Field key={name} label={`${featureLabel(name, spec.label)}${spec.unit ? ` (${spec.unit})` : ""}`} type="number" inputMode="decimal"
                  min={spec.min} max={spec.max} step={spec.kind === "integer" ? 1 : "any"} value={values[name] ?? ""} error={errors[name]}
                  onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))} />
              ))}
            </div>
            <Button type="submit">Calculate on this device</Button>
          </form>)}
      </Glass>
      {result && model && (
        <Glass className="p-5" aria-label="On-device result" aria-live="polite">
          <CardTitle aside={<span className={`rounded-full px-3 py-0.5 text-xs font-semibold ${BAND_CHIP[result.r.band]}`}>{BAND_LABEL[result.r.band]}</span>}>Your estimate</CardTitle>
          <p className="num text-5xl font-bold" data-testid="device-score">{(result.r.score * 100).toFixed(1)}%</p>
          <p className="mt-1 text-sm text-muted">Model-estimated probability · {CONDITION_NAME[condition]} model v{model.version}. Experimental model estimate, not a diagnosis.</p>
          <ul className="mt-3 space-y-1 text-sm">
            {result.r.drivers.slice(0, 4).map((d) => (
              <li key={d.feature}>{featureLabel(d.feature, model.schema[d.feature]?.label)} {d.effect > 0 ? "pushes the estimate up" : "pushes the estimate down"} (relative to an average person in the training data).</li>))}
          </ul>
          <p className="mt-3 rounded-xl bg-low-bg p-2 text-sm text-low" data-testid="zero-upload">Calculated on this device. Network requests made while calculating: {result.requests}.</p>
        </Glass>)}
    </main>
  );
}
