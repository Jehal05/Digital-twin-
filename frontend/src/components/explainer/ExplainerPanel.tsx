import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { Consents, ExplainReply } from "../../api/types";
import { useDashboard } from "../../auth/DataContext";

const TOPICS: [string, string][] = [["summary", "Summarise"], ["why", "Why this score?"], ["uncertainty", "How sure is it?"], ["what_can_change", "What can change?"], ["about_model", "About the model"]];
interface Msg { role: "you" | "ai"; text: string; source?: ExplainReply["source"] }
const SOURCE: Record<string, string> = { template: "Built from your stored results", llm: "AI-written, checked against your numbers", safety: "Safety message" };

export function ExplainerPanel() {
  const { data } = useDashboard();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [consents, setConsents] = useState<Consents | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const pred = data?.latest_predictions.diabetes ?? null;
  const free = !!consents?.ai_explainer_available && !!consents.current.ai_explainer?.granted;

  useEffect(() => { if (open) api.get<Consents>("/privacy/consents").then(setConsents).catch(() => setConsents(null)); }, [open]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [msgs]);

  async function ask(body: { topic?: string; question?: string }, label: string) {
    if (!pred) return;
    setMsgs((m) => [...m, { role: "you", text: label }]); setBusy(true);
    try {
      const r = await api.post<ExplainReply>("/explain", { prediction_id: pred.id, ...body });
      setMsgs((m) => [...m, { role: "ai", text: r.answer, source: r.source }]);
    } catch (e) { setMsgs((m) => [...m, { role: "ai", text: e instanceof ApiError ? e.message : "Something went wrong." }]); } finally { setBusy(false); }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); const t = q.trim(); if (t) { setQ(""); void ask({ question: t }, t); } };

  return (
    <div className="no-print fixed bottom-5 right-5 z-20 flex flex-col items-end gap-2">
      {open && (
        <div role="dialog" aria-label="AI explainer" className="glass flex max-h-[70vh] w-[min(92vw,380px)] flex-col p-4 text-sm">
          <div className="flex items-center justify-between"><p className="font-semibold">Explain my estimate</p><button onClick={() => setOpen(false)} aria-label="Close explainer" className="text-lg leading-none">×</button></div>
          {!pred ? <p className="mt-2 text-muted">Run an estimate on the dashboard first, then I can explain it.</p> : (
            <>
              <div className="mt-2 flex flex-wrap gap-1.5">{TOPICS.map(([k, l]) => <button key={k} disabled={busy} onClick={() => void ask({ topic: k }, l)} className="rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold hover:bg-white disabled:opacity-60">{l}</button>)}</div>
              <div className="mt-3 min-h-[80px] flex-1 space-y-2 overflow-y-auto" aria-live="polite">
                {msgs.map((m, i) => (<div key={i} className={m.role === "you" ? "text-right" : ""}>
                  <p className={`inline-block max-w-full rounded-2xl px-3 py-2 text-left ${m.role === "you" ? "bg-brand text-white" : "bg-white"}`}>{m.text}</p>
                  {m.source && <p className="mt-0.5 text-[11px] text-muted">{SOURCE[m.source]}</p>}</div>))}
                {busy && <p className="text-xs text-muted">Thinking…</p>}<div ref={end} />
              </div>
              {free ? (
                <form onSubmit={submit} className="mt-2 flex gap-2"><input value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} aria-label="Ask a question" placeholder="Ask about this estimate" className="min-w-0 flex-1 rounded-full border border-[#9fb0d3] bg-white px-3 py-1.5" /><button disabled={busy || !q.trim()} className="rounded-full bg-brand px-4 text-xs font-semibold text-white disabled:opacity-60">Ask</button></form>
              ) : <p className="mt-2 text-xs text-muted">Free-text questions are off{consents && !consents.ai_explainer_available ? ": no AI service is configured on this server" : ". Allow them in "}{consents?.ai_explainer_available ? <Link to="/settings" className="font-semibold underline">Settings</Link> : null}.</p>}
              <p className="mt-2 text-[11px] text-muted">Experimental model estimate, not a diagnosis. I explain the model, not your health, and can't help with symptoms.</p>
            </>)}
        </div>)}
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="AI explainer" className="grid h-14 w-14 place-items-center rounded-full bg-brand text-xl text-white shadow-lg hover:bg-[#2249a8]">✦</button>
    </div>
  );
}
