import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { CommitResult, CsvPreview, LabPreview } from "../api/types";
import { useDashboard } from "../auth/DataContext";
import { Button } from "../components/ui/Button";
import { ContentTag } from "../components/ui/ContentTag";
import { CardTitle, Glass } from "../components/ui/Glass";
import { MEASUREMENT_LABEL, MEASUREMENT_UNITS } from "../lib/format";

function Result({ r }: { r: CommitResult }) {
  return (
    <div role="status" className="mt-4 rounded-xl bg-low-bg p-3 text-sm">
      <p className="font-semibold text-low">Saved {r.created} reading{r.created === 1 ? "" : "s"}.</p>
      <ul className="mt-1 list-disc pl-5 text-xs">
        {r.skipped_duplicates > 0 && <li>{r.skipped_duplicates} already existed and were skipped.</li>}
        {r.flagged > 0 && <li>{r.flagged} looked unusual and need a check on <Link className="underline" to="/profile">My data</Link>.</li>}
        {r.errors.map((e) => <li key={e.index}>Row {e.index + 1}: {e.message}</li>)}
      </ul>
    </div>
  );
}

function FileInput({ label, accept, onFile, busy }: { label: string; accept: string; onFile: (f: File) => void; busy: boolean }) {
  return (
    <label className="block text-sm font-medium">{label}
      <input type="file" accept={accept} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
        className="mt-1 block w-full rounded-xl border border-dashed border-field bg-card/80 p-3 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand file:px-4 file:py-1.5 file:text-sm file:font-semibold file:text-on-strong" />
    </label>
  );
}

function CsvImport() {
  const { reload } = useDashboard();
  const [p, setP] = useState<CsvPreview | null>(null);
  const [res, setRes] = useState<CommitResult | null>(null);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const ok = p?.rows.filter((r) => r.status === "ok") ?? [];

  async function preview(f: File) {
    setBusy(true); setErr(""); setRes(null); setP(null);
    try { setP(await api.upload<CsvPreview>("/imports/csv/preview", f)); } catch (e) { setErr(e instanceof ApiError ? e.message : "Could not read that file."); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setErr("");
    try {
      setRes(await api.post<CommitResult>("/imports/commit", { source: "csv", rows: ok.slice(0, 500).map((r) => ({ measurement_type: r.measurement_type, value: r.value, unit: r.unit, recorded_at: r.recorded_at })) }));
      setP(null); await reload();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Something went wrong."); } finally { setBusy(false); }
  }
  return (
    <Glass className="p-5" aria-label="Import a CSV">
      <CardTitle aside={<ContentTag kind="measured" />}>Wearable or spreadsheet CSV</CardTitle>
      <p className="mb-3 text-sm text-muted">Needs a date column (recorded_at, timestamp or date) and either columns like steps, sleep_hours, resting_hr, weight_kg, or the layout measurement_type,value,unit,recorded_at. You review everything before it is saved.</p>
      <FileInput label="Choose a .csv file" accept=".csv,text/csv" onFile={(f) => void preview(f)} busy={busy} />
      {err && <p role="alert" className="mt-3 text-sm font-medium text-high">{err}</p>}
      {p && (
        <div className="mt-4">
          <p className="text-sm"><strong>{p.summary.ok}</strong> valid, <strong className={p.summary.errors ? "text-high" : ""}>{p.summary.errors}</strong> with problems. Problem rows are not saved.</p>
          <div className="mt-2 max-h-72 overflow-auto rounded-xl bg-card/70"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-card"><tr><th className="p-2">Line</th><th>Reading</th><th>Value</th><th>When (UTC)</th><th>Status</th></tr></thead>
            <tbody>{p.rows.slice(0, 200).map((r, i) => (<tr key={i} className="border-t border-line"><td className="p-2 num">{r.line}</td><td>{MEASUREMENT_LABEL[r.measurement_type] ?? r.measurement_type}</td>
              <td className="num">{r.value ?? "—"} {r.unit}</td><td className="num">{r.recorded_at?.slice(0, 16).replace("T", " ") ?? "—"}</td>
              <td>{r.status === "ok" ? <span className="text-low">{r.note ? `OK (${r.note})` : "OK"}</span> : <span className="font-medium text-high">{r.message}</span>}</td></tr>))}</tbody></table></div>
          {p.rows.length > 200 && <p className="mt-1 text-xs text-muted">Showing the first 200 of {p.rows.length} rows.</p>}
          {ok.length > 500 && <p className="mt-1 text-xs font-medium text-moderate">Only the first 500 valid rows are saved per import. Import again for the rest.</p>}
          <div className="mt-3 flex gap-2"><Button onClick={() => void save()} disabled={busy || ok.length === 0}>Save {Math.min(ok.length, 500)} valid rows</Button><Button variant="ghost" onClick={() => setP(null)}>Cancel</Button></div>
        </div>)}
      {res && <Result r={res} />}
    </Glass>
  );
}

interface Item { key: number; include: boolean; type: string; value: string; unit: string; snippet: string; conf: string; unitSeen: boolean }

function LabImport() {
  const { reload } = useDashboard();
  const [pv, setPv] = useState<LabPreview | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [date, setDate] = useState("");
  const [res, setRes] = useState<CommitResult | null>(null);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  async function preview(f: File) {
    setBusy(true); setErr(""); setRes(null); setPv(null);
    try {
      const r = await api.upload<LabPreview>("/imports/lab-report/preview", f);
      setPv(r); setDate(r.detected_dates.length === 1 ? r.detected_dates[0] : "");
      setItems(r.candidates.map((c, i) => ({ key: i, include: true, type: c.measurement_type, value: String(c.value), unit: c.unit, snippet: c.snippet, conf: c.confidence, unitSeen: c.unit_found_in_text })));
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Could not read that file."); } finally { setBusy(false); }
  }
  const chosen = items.filter((i) => i.include && i.value.trim() !== "" && !Number.isNaN(Number(i.value)));
  const set = (key: number, patch: Partial<Item>) => setItems(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  async function save() {
    setBusy(true); setErr("");
    try {
      const at = new Date(`${date}T12:00:00`).toISOString();
      setRes(await api.post<CommitResult>("/imports/commit", { source: "ocr", rows: chosen.map((i) => ({ measurement_type: i.type, value: Number(i.value), unit: i.unit, recorded_at: at,
        ...(pv?.ocr_confidence != null ? { ocr_confidence: Math.min(1, Math.max(0, pv.ocr_confidence)) } : {}) })) }));
      setPv(null); setItems([]); await reload();
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Something went wrong."); } finally { setBusy(false); }
  }
  return (
    <Glass className="p-5" aria-label="Read a lab report">
      <CardTitle aside={<ContentTag kind="measured" />}>Lab report (photo, scan or PDF)</CardTitle>
      <p className="mb-3 text-sm text-muted">The file is read on the server and then discarded, never stored. Text recognition makes mistakes, so nothing is saved until you have checked each value.</p>
      <FileInput label="Choose a PNG, JPEG or PDF" accept="image/png,image/jpeg,application/pdf" onFile={(f) => void preview(f)} busy={busy} />
      {busy && !pv && <p role="status" className="mt-3 text-sm text-muted">Reading the report…</p>}
      {err && <p role="alert" className="mt-3 text-sm font-medium text-high">{err}</p>}
      {pv && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted">Read by {pv.method === "ocr" ? `text recognition (average confidence ${Math.round((pv.ocr_confidence ?? 0) * 100)}%)` : "the PDF's own text"}. Compare each line with your report.</p>
          {items.length === 0 ? <p className="rounded-xl bg-moderate-bg p-3 text-sm text-moderate">No known values were found. Try a clearer image, or add the readings by hand.</p> : (
            <ul className="space-y-2">{items.map((i) => (
              <li key={i.key} className="panel-dim p-3 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <input type="checkbox" checked={i.include} aria-label={`Include ${MEASUREMENT_LABEL[i.type]}`} onChange={(e) => set(i.key, { include: e.target.checked })} />
                  <span className="w-28 font-medium">{MEASUREMENT_LABEL[i.type] ?? i.type}</span>
                  <input aria-label={`${MEASUREMENT_LABEL[i.type]} value`} inputMode="decimal" value={i.value} onChange={(e) => set(i.key, { value: e.target.value })} className="num w-24 rounded-lg border border-field bg-card px-2 py-1" />
                  <select aria-label={`${MEASUREMENT_LABEL[i.type]} unit`} value={i.unit} onChange={(e) => set(i.key, { unit: e.target.value })} className="rounded-lg border border-field bg-card px-2 py-1">
                    {(MEASUREMENT_UNITS[i.type] ?? [i.unit]).map((u) => <option key={u}>{u}</option>)}</select>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${i.conf === "high" ? "bg-low-bg text-low" : i.conf === "medium" ? "bg-moderate-bg text-moderate" : "bg-high-bg text-high"}`}>{i.conf} confidence</span>
                </div>
                <p className="mt-1 text-xs text-muted">Found: “{i.snippet}”{!i.unitSeen && <span className="font-medium text-moderate"> · no unit found in the text, please confirm it</span>}</p>
              </li>))}</ul>)}
          <div><label htmlFor="lab-date" className="text-sm font-medium">Date the sample was taken (required)</label>
            <div className="mt-1 flex flex-wrap items-center gap-2"><input id="lab-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-field bg-card px-2 py-1 text-sm" />
              {pv.detected_dates.map((d) => <button key={d} type="button" onClick={() => setDate(d)} className="rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold">Use {d}</button>)}</div>
            <p className="mt-1 text-xs text-muted">{pv.ambiguous_dates_found ? "The report has dates like 03/04/2026 that could be read two ways, so please choose the date yourself. " : ""}The time is recorded as 12:00.</p></div>
          <div className="flex gap-2"><Button onClick={() => void save()} disabled={busy || !date || chosen.length === 0}>Save {chosen.length} reading{chosen.length === 1 ? "" : "s"}</Button><Button variant="ghost" onClick={() => { setPv(null); setItems([]); }}>Cancel</Button></div>
        </div>)}
      {res && <Result r={res} />}
    </Glass>
  );
}

export function ImportPage() {
  return (
    <div className="space-y-4">
      <Glass className="p-5"><h1 className="text-2xl font-bold tracking-tight">Import data</h1><p className="mt-1 text-sm text-muted">Bring in readings you already have. <Link to="/profile" className="font-semibold text-brand underline">Back to My data</Link></p></Glass>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start"><LabImport /><CsvImport /></div>
    </div>
  );
}
