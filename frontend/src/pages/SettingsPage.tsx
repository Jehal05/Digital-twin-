import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Consents } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { LOCALES } from "../i18n/strings";
import { usePrefs, type ThemeChoice } from "../prefs/PrefsContext";
import { CardTitle, Glass } from "../components/ui/Glass";

export function SettingsPage() {
  const { logout } = useAuth();
  const { t, theme, locale, reducedMotion, update } = usePrefs();
  const [c, setC] = useState<Consents | null>(null);
  const [msg, setMsg] = useState("");
  const [pw, setPw] = useState(""), [sure, setSure] = useState(false), [delErr, setDelErr] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { api.get<Consents>("/privacy/consents").then(setC).catch(() => setMsg("Could not load your settings.")); }, []);
  const ai = c?.current.ai_explainer?.granted ?? false;

  async function toggleAi(granted: boolean) {
    setMsg("");
    try { await api.post("/privacy/consents", { consent_type: "ai_explainer", granted }); setC(await api.get<Consents>("/privacy/consents")); setMsg(granted ? "AI explainer allowed." : "AI explainer turned off."); }
    catch (e) { setMsg(e instanceof ApiError ? e.message : "Something went wrong."); }
  }
  async function exportData() {
    setMsg("");
    try {
      const url = URL.createObjectURL(await api.download("/privacy/export"));
      const a = Object.assign(document.createElement("a"), { href: url, download: "healthtwin-export.json" });
      document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url); setMsg("Your export has downloaded.");
    } catch (e) { setMsg(e instanceof ApiError ? e.message : "Export failed."); }
  }
  async function del(e: FormEvent) {
    e.preventDefault(); setDelErr(""); setBusy(true);
    try { await api.del("/privacy/account", { password: pw }); await logout(); }
    catch (err) { setDelErr(err instanceof ApiError ? err.message : "Something went wrong."); setBusy(false); }
  }
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Glass className="p-5"><h1 className="text-2xl font-bold tracking-tight">{t("set.title")}</h1><p className="mt-1 text-sm text-muted">You are in control of what is stored and who can see it.</p>{msg && <p role="status" className="mt-2 text-sm font-medium">{msg}</p>}</Glass>
      <Glass className="p-5" aria-label={t("set.appearance")}><CardTitle>{t("set.appearance")}</CardTitle>
        <fieldset><legend className="text-sm font-medium">{t("set.theme")}</legend>
          <div className="mt-1 flex flex-wrap gap-4 text-sm">{(["system", "light", "dark"] as ThemeChoice[]).map((v) => (
            <label key={v} className="flex items-center gap-1.5"><input type="radio" name="theme" value={v} checked={theme === v} onChange={() => update({ theme: v })} />{t(`set.theme.${v}` as const)}</label>))}</div></fieldset>
        <div className="mt-3"><label htmlFor="lang" className="text-sm font-medium">{t("set.language")}</label>
          <select id="lang" value={locale} onChange={(e) => update({ locale: e.target.value as typeof locale })} className="mt-1 block rounded-xl border border-field bg-card px-3 py-2 text-sm">
            {LOCALES.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.label}</option>)}</select>
          <p className="mt-1 text-xs text-muted">{t("set.partial")}</p></div>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={reducedMotion} onChange={(e) => update({ reducedMotion: e.target.checked })} />{t("set.motion")}</label></Glass>
      <Glass className="p-5" aria-label="AI explainer consent"><CardTitle>AI explainer</CardTitle>
        <p className="text-sm text-muted">The built-in explanations always work and run on this server. If an AI service is configured, it can also answer free-text questions. It only receives your estimate and its inputs (no name or email), and its answer is discarded if it contains a number that is not in your results.</p>
        <label className="mt-3 flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={ai} disabled={!c} onChange={(e) => void toggleAi(e.target.checked)} />Allow the AI explainer to use my results</label>
        {c && !c.ai_explainer_available && <p className="mt-1 text-xs text-muted">No AI service is configured on this server, so this has no effect yet.</p>}</Glass>
      <Glass className="p-5" aria-label="Your data"><CardTitle>Your data</CardTitle>
        <p className="mb-3 text-sm text-muted">Download everything stored about you as a JSON file. Passwords and sign-in tokens are never included. Lab report files are not kept at all.</p>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void exportData()}>Download my data</Button><Link to="/report"><Button variant="secondary">Manage share links</Button></Link></div></Glass>
      <Glass className="border-high p-5" aria-label="Delete account"><CardTitle>Delete my account</CardTitle>
        <p className="mb-3 text-sm text-muted">This permanently removes your account, readings, estimates, scenarios and share links. It cannot be undone.</p>
        <form onSubmit={del} className="space-y-3" aria-label="Delete account"><Field label="Confirm with your password" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} error={delErr} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />I understand this is permanent</label>
          <Button type="submit" className="bg-high hover:brightness-90" disabled={!sure || !pw || busy}>{busy ? "Deleting…" : "Delete everything"}</Button></form></Glass>
    </div>
  );
}
