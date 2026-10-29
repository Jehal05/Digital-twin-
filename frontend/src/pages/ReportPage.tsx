import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Report, ShareLinkInfo } from "../api/types";
import { ReportView } from "../components/report/ReportView";
import { Button } from "../components/ui/Button";
import { CardTitle, Glass } from "../components/ui/Glass";
import { ErrorState, Skeleton } from "../components/ui/States";

const SECTIONS = [["profile", "Age, sex, height"], ["measurements", "Readings summary"], ["estimates", "Model estimates"]] as const;

function Sharing() {
  const [links, setLinks] = useState<ShareLinkInfo[] | null>(null);
  const [days, setDays] = useState(7);
  const [inc, setInc] = useState<string[]>(["measurements", "estimates"]);
  const [fresh, setFresh] = useState<ShareLinkInfo | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => { try { setLinks((await api.get<{ items: ShareLinkInfo[] }>("/share")).items); } catch { setLinks([]); } }, []);
  useEffect(() => { void load(); }, [load]);
  const url = fresh?.path ? `${window.location.origin}${fresh.path}` : "";

  async function create() {
    setMsg("");
    try { setFresh(await api.post<ShareLinkInfo>("/share", { expires_in_days: days, include: inc })); await load(); }
    catch (e) { setMsg(e instanceof ApiError ? e.message : "Something went wrong."); }
  }
  async function revoke(id: string) { try { await api.del(`/share/${id}`); if (fresh?.id === id) setFresh(null); await load(); } catch (e) { setMsg(e instanceof ApiError ? e.message : "Something went wrong."); } }
  return (
    <Glass className="no-print p-5" aria-label="Share with a clinician">
      <CardTitle>Share a read-only link</CardTitle>
      <p className="mb-3 text-sm text-muted">Anyone with the link can see what you tick below until it expires or you revoke it. It never includes your name or email.</p>
      <fieldset className="flex flex-wrap gap-4 text-sm"><legend className="mb-1 text-xs text-muted">Include</legend>
        {SECTIONS.map(([k, label]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={inc.includes(k)} onChange={(e) => setInc(e.target.checked ? [...inc, k] : inc.filter((x) => x !== k))} />{label}</label>)}</fieldset>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="text-sm">Expires in <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="ml-1 rounded-lg border border-[#9fb0d3] bg-white px-2 py-1">
          {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}</select></label>
        <Button onClick={() => void create()} disabled={inc.length === 0}>Create link</Button>
      </div>
      {msg && <p role="alert" className="mt-2 text-sm text-high">{msg}</p>}
      {fresh && url && (
        <div className="mt-3 rounded-xl bg-low-bg p-3 text-sm" role="status"><p className="font-semibold text-low">Link created. Copy it now: it will not be shown again.</p>
          <div className="mt-1 flex gap-2"><input readOnly aria-label="Share link" value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-[#9fb0d3] bg-white px-2 py-1 text-xs" />
            <Button variant="secondary" className="min-h-8" onClick={() => void navigator.clipboard?.writeText(url)}>Copy</Button></div></div>)}
      <h3 className="mt-4 text-sm font-semibold">Your links</h3>
      {links === null ? <Skeleton className="mt-2 h-10" /> : links.length === 0 ? <p className="mt-1 text-sm text-muted">No links yet.</p> : (
        <ul className="mt-2 space-y-2">{links.map((l) => (
          <li key={l.id} className="panel-dim flex flex-wrap items-center gap-3 p-2.5 text-sm">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${l.active ? "bg-low-bg text-low" : "bg-dim text-muted"}`}>{l.revoked ? "Revoked" : l.active ? "Active" : "Expired"}</span>
            <span className="flex-1">{l.include.join(", ")} · until {new Date(l.expires_at).toLocaleDateString()}</span>
            {l.active && <button onClick={() => void revoke(l.id)} className="text-xs font-semibold text-high underline" aria-label={`Revoke link created ${new Date(l.created_at).toLocaleString()}`}>Revoke</button>}</li>))}</ul>)}
    </Glass>
  );
}

export function ReportPage() {
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.get<Report>("/report").then(setR).catch((e) => setErr(e.message ?? "Could not load the report.")); }, []);
  return (
    <div className="space-y-4">
      <div className="no-print flex items-center gap-3"><Button onClick={() => window.print()}>Print or save as PDF</Button><p className="text-sm text-white/90">Prints cleanly without the navigation.</p></div>
      {err ? <ErrorState message={err} /> : r ? <ReportView r={r} /> : <Skeleton className="h-64" />}
      <Sharing />
    </div>
  );
}
