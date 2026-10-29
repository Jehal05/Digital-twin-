import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Logo } from "../components/layout/Logo";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";

export function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [ai, setAi] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const reg = mode === "register";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({}); setFormError("");
    if (reg && !consent) { setFormError("Please agree to the data processing terms to create an account."); return; }
    setBusy(true);
    try {
      if (reg) await register({ email, password, display_name: name.trim() || undefined, ai_explainer: ai });
      else await login(email, password);
    } catch (err) {
      if (err instanceof ApiError) { setErrors(err.fields); setFormError(err.message); } else setFormError("Could not reach the server. Try again.");
    } finally { setBusy(false); }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <div className="glass w-full max-w-md p-7">
        <div className="mb-5 flex items-center gap-3"><Logo size={44} /><div><h1 className="text-2xl font-bold tracking-tight">HealthTwin</h1>
          <p className="text-sm text-muted">Explore how your numbers may relate to health risk.</p></div></div>
        <div role="tablist" aria-label="Account" className="mb-5 grid grid-cols-2 rounded-full bg-dim p-1 text-sm font-semibold">
          {(["login", "register"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErrors({}); setFormError(""); }}
              className={`rounded-full py-2 ${mode === m ? "bg-white shadow" : "text-muted"}`}>{m === "login" ? "Sign in" : "Create account"}</button>
          ))}
        </div>
        <form onSubmit={submit} noValidate className="space-y-4" aria-label={reg ? "Create account" : "Sign in"}>
          {reg && <Field label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" error={errors.display_name} />}
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required error={errors.email} />
          <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={reg ? "new-password" : "current-password"} required error={errors.password}
            hint={reg ? "At least 12 characters, with letters and numbers." : undefined} />
          {reg && (
            <fieldset className="space-y-2 text-sm">
              <legend className="sr-only">Consent</legend>
              <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
                <span>I agree that HealthTwin stores and processes the health data I enter in order to produce estimates. I can export or delete it at any time. (required)</span></label>
              <label className="flex gap-2"><input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} className="mt-1" />
                <span>Allow the optional AI explainer to use my results to write explanations.</span></label>
            </fieldset>
          )}
          {formError && <p role="alert" className="rounded-xl bg-high-bg p-3 text-sm font-medium text-high">{formError}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Please wait…" : reg ? "Create account" : "Sign in"}</Button>
        </form>
        <p className="mt-5 text-xs text-muted">Experimental model estimates, not a diagnosis. Not a medical device.</p>
      </div>
    </main>
  );
}
