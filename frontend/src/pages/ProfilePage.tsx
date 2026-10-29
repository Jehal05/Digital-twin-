import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Measurement } from "../api/types";
import { useDashboard } from "../auth/DataContext";
import { Button } from "../components/ui/Button";
import { Field, SelectField } from "../components/ui/Field";
import { ContentTag } from "../components/ui/ContentTag";
import { CardTitle, Glass } from "../components/ui/Glass";
import { EmptyState } from "../components/ui/States";
import { MEASUREMENT_LABEL, MEASUREMENT_UNITS, timeAgo } from "../lib/format";

const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function ProfileForm() {
  const { data, reload } = useDashboard();
  const [dob, setDob] = useState(""), [sex, setSex] = useState(""), [height, setHeight] = useState(""), [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    const p = data?.profile; if (!p) return;
    setDob(p.date_of_birth ?? ""); setSex(p.sex ?? ""); setHeight(p.height_cm?.toString() ?? ""); setName(p.display_name ?? "");
  }, [data?.profile]);

  async function save(e: FormEvent) {
    e.preventDefault(); setErrors({}); setMsg(""); setBusy(true);
    const body: Record<string, unknown> = {};
    if (dob) body.date_of_birth = dob;
    if (sex) body.sex = sex;
    if (height) body.height_cm = Number(height);
    if (name.trim()) body.display_name = name.trim();
    try { await api.put("/profile", body); await reload(); setMsg("Profile saved."); }
    catch (err) { if (err instanceof ApiError) { setErrors(err.fields); setMsg(err.message); } else setMsg("Something went wrong."); }
    finally { setBusy(false); }
  }
  return (
    <Glass className="p-5" aria-label="Profile">
      <CardTitle>Profile</CardTitle>
      <form onSubmit={save} noValidate className="grid gap-4 sm:grid-cols-2" aria-label="Profile details">
        <Field label="Display name" value={name} onChange={(e) => setName(e.target.value)} error={errors.display_name} />
        <Field label="Date of birth" type="date" value={dob} onChange={(e) => setDob(e.target.value)} error={errors.date_of_birth} hint="Used to work out your age." />
        <SelectField label="Sex" value={sex} onChange={(e) => setSex(e.target.value)} error={errors.sex}>
          <option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
        </SelectField>
        <Field label="Height (cm)" type="number" step="0.1" value={height} onChange={(e) => setHeight(e.target.value)} error={errors.height_cm} />
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</Button>
          {msg && <p role="status" className="text-sm text-muted">{msg}</p>}
        </div>
      </form>
    </Glass>
  );
}

function AddMeasurement() {
  const { reload } = useDashboard();
  const [type, setType] = useState("glucose_mgdl");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("mg/dL");
  const [when, setWhen] = useState(localNow());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const units = MEASUREMENT_UNITS[type];

  async function add(e: FormEvent) {
    e.preventDefault(); setErrors({}); setMsg("");
    if (value.trim() === "" || Number.isNaN(Number(value))) { setErrors({ value: "Enter a number" }); return; }
    setBusy(true);
    try {
      const m = await api.post<Measurement>("/measurements", { measurement_type: type, value: Number(value), unit, recorded_at: new Date(when).toISOString() });
      setValue(""); await reload();
      setMsg(m.validation_status === "flagged" ? "Saved, but it looks unusual compared with your history. Please review it below." : "Reading saved.");
    } catch (err) { if (err instanceof ApiError) { setErrors(err.fields); setMsg(err.message); } else setMsg("Something went wrong."); }
    finally { setBusy(false); }
  }
  return (
    <Glass className="p-5" aria-label="Add a reading">
      <CardTitle aside={<ContentTag kind="measured" />}>Add a reading</CardTitle>
      <form onSubmit={add} noValidate className="grid gap-4 sm:grid-cols-2" aria-label="New measurement">
        <SelectField label="What was measured" value={type} onChange={(e) => { setType(e.target.value); setUnit(MEASUREMENT_UNITS[e.target.value][0]); }} error={errors.measurement_type}>
          {Object.keys(MEASUREMENT_UNITS).map((k) => <option key={k} value={k}>{MEASUREMENT_LABEL[k]}</option>)}
        </SelectField>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label="Value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} error={errors.value} />
          <SelectField label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} error={errors.unit}>
            {units.map((u) => <option key={u}>{u}</option>)}
          </SelectField>
        </div>
        <Field label="When" type="datetime-local" max={localNow()} value={when} onChange={(e) => setWhen(e.target.value)} error={errors.recorded_at} />
        <div className="flex items-end gap-3 pb-5"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Add reading"}</Button></div>
        {msg && <p role="status" className="text-sm text-muted sm:col-span-2">{msg}</p>}
      </form>
      <p className="mt-2 text-xs text-muted">Readings are never overwritten. A correction is saved as a new reading and the old one is hidden, not edited.</p>
    </Glass>
  );
}

function Readings() {
  const { reload } = useDashboard();
  const [items, setItems] = useState<Measurement[] | null>(null);
  const [flagged, setFlagged] = useState<Measurement[]>([]);
  const [fix, setFix] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const { data } = useDashboard();

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [a, b] = await Promise.all([api.get<{ items: Measurement[] }>("/measurements?limit=20"), api.get<{ items: Measurement[] }>("/measurements/flagged")]);
        if (live) { setItems(a.items); setFlagged(b.items); }
      } catch { if (live) setErr("Could not load your readings."); }
    })();
    return () => { live = false; };
  }, [data]);

  async function resolve(id: string, body: Record<string, unknown>) {
    setErr("");
    try { await api.post(`/measurements/${id}/resolve`, body); await reload(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Something went wrong."); }
  }

  return (
    <Glass className="p-5" aria-label="Recent readings">
      <CardTitle aside={<Link to="/import" className="text-sm font-semibold text-brand underline">Import a file</Link>}>Recent readings</CardTitle>
      {err && <p role="alert" className="mb-3 text-sm text-high">{err}</p>}
      {flagged.length > 0 && (
        <div className="mb-4 space-y-2" role="region" aria-label="Readings to review">
          {flagged.map((m) => (
            <div key={m.id} className="rounded-2xl bg-moderate-bg p-3 text-sm">
              <p className="font-semibold text-moderate">{MEASUREMENT_LABEL[m.measurement_type]} {m.value} {m.unit} needs a check</p>
              <p className="text-xs">{m.flag_reason}</p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Button variant="secondary" className="min-h-9" onClick={() => void resolve(m.id, { action: "confirm" })}>Yes, this is right</Button>
                <div className="w-28"><Field label="Corrected value" inputMode="decimal" value={fix[m.id] ?? ""} onChange={(e) => setFix({ ...fix, [m.id]: e.target.value })} /></div>
                <Button variant="secondary" className="mb-5 min-h-9" disabled={!fix[m.id] || Number.isNaN(Number(fix[m.id]))}
                  onClick={() => void resolve(m.id, { action: "correct", value: Number(fix[m.id]) })}>Save correction</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {items === null ? <p className="text-sm text-muted">Loading…</p> : items.length === 0 ? (
        <EmptyState title="No readings yet">Add your first reading above to start building your history.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>{MEASUREMENT_LABEL[m.measurement_type] ?? m.measurement_type}</span>
              <span className="num font-semibold">{m.value} {m.unit}</span>
              <span className="text-xs text-muted">{timeAgo(m.recorded_at)}{m.validation_status === "flagged" ? " · flagged" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </Glass>
  );
}

export function ProfilePage() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4"><ProfileForm /><AddMeasurement /></div>
      <Readings />
    </div>
  );
}
