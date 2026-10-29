import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useDashboard } from "../../auth/DataContext";
import { Button } from "../ui/Button";
import { Logo } from "./Logo";

const NAV: { to: string; label: string; soon?: boolean }[] = [
  { to: "/", label: "Dashboard" },
  { to: "/profile", label: "My data" },
  { to: "/simulator", label: "Simulator", soon: true },
  { to: "/trends", label: "Trends", soon: true },
  { to: "/reliability", label: "Model reliability", soon: true },
];
const STEPS = ["My Health Data", "AI Analysis", "Explain Why", "Simulate Changes", "Track Over Time"];

function stepIndex(path: string, hasData: boolean, hasEstimate: boolean) {
  if (path.startsWith("/profile")) return 0;
  if (hasEstimate) return 2;
  return hasData ? 1 : 0;
}

export function SummaryBar() {
  const { data } = useDashboard();
  if (!data) return null;
  const p = data.profile, m = data.latest_measurements;
  const items: [string, string][] = [
    ["Age", p.age !== null ? String(p.age) : "—"],
    ["Weight", m.weight_kg ? `${m.weight_kg.value} kg` : "—"],
    ["BMI", p.bmi ? `${p.bmi.value}` : "—"],
    ["Glucose", m.glucose_mgdl ? `${m.glucose_mgdl.value} mg/dL` : "—"],
  ];
  const name = p.display_name || p.email.split("@")[0];
  return (
    <section aria-label="Summary" className="glass flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
      <p className="text-sm"><span className="text-muted">Hello,</span> <strong>{name}</strong></p>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {items.map(([k, v]) => (
          <div key={k} className="flex gap-1.5"><dt className="text-muted">{k}</dt><dd className="num font-semibold">{v}</dd></div>
        ))}
      </dl>
      {data.flagged_count > 0 && <NavLink to="/profile" className="ml-auto rounded-full bg-moderate-bg px-3 py-1 text-xs font-semibold text-moderate">{data.flagged_count} reading{data.flagged_count > 1 ? "s" : ""} to review</NavLink>}
    </section>
  );
}

export function ProgressRail({ current }: { current: number }) {
  return (
    <ol aria-label="Your journey" className="flex flex-wrap gap-2 text-xs">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === current ? "step" : undefined}
          className={`rounded-full px-3 py-1.5 font-semibold ${i === current ? "bg-brand text-white" : i < current ? "bg-brand-soft text-ink" : "bg-white/60 text-muted"}`}>
          {i + 1}. {s}
        </li>
      ))}
    </ol>
  );
}

function AssistantFab() {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed bottom-5 right-5 z-20 flex flex-col items-end gap-2">
      {open && (
        <div role="dialog" aria-label="AI explainer" className="glass max-w-xs p-4 text-sm">
          <p className="font-semibold">AI explainer</p>
          <p className="mt-1 text-muted">Plain-language explanations of your results arrive in a later release. Until then, the "Why the risk?" card shows the model's real drivers.</p>
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="AI explainer"
        className="grid h-14 w-14 place-items-center rounded-full bg-brand text-xl text-white shadow-lg hover:bg-[#2249a8]">✦</button>
    </div>
  );
}

export function AppShell() {
  const { logout } = useAuth();
  const { data } = useDashboard();
  const loc = useLocation();
  const hasEstimate = !!data && Object.values(data.latest_predictions).some(Boolean);
  const hasData = !!data && Object.keys(data.latest_measurements).length > 0;
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-4 py-4 md:px-6">
      <a href="#main" className="sr-only focus:not-sr-only focus:rounded focus:bg-white focus:p-2">Skip to content</a>
      <header className="glass flex flex-wrap items-center gap-3 px-5 py-3">
        <div className="flex items-center gap-2.5"><Logo /><span className="text-lg font-bold tracking-tight">HealthTwin</span></div>
        <nav aria-label="Main" className="order-3 flex w-full flex-wrap gap-1 md:order-none md:ml-4 md:w-auto">
          {NAV.map((n) => n.soon ? (
            <span key={n.to} aria-disabled="true" title="Coming in a later release" className="cursor-not-allowed rounded-full px-3 py-1.5 text-sm text-muted">
              {n.label} <span className="rounded bg-dim px-1.5 text-[10px] font-semibold uppercase">Soon</span>
            </span>
          ) : (
            <NavLink key={n.to} to={n.to} end={n.to === "/"}
              className={({ isActive }) => `rounded-full px-3 py-1.5 text-sm font-medium ${isActive ? "bg-brand text-white" : "hover:bg-brand-soft"}`}>{n.label}</NavLink>
          ))}
        </nav>
        <Button variant="secondary" className="ml-auto" onClick={() => void logout()}>Sign out</Button>
      </header>
      <SummaryBar />
      <ProgressRail current={stepIndex(loc.pathname, hasData, hasEstimate)} />
      <main id="main" className="flex-1" tabIndex={-1}><Outlet /></main>
      <footer className="pb-16 text-xs text-muted">
        <p>HealthTwin is an educational project. Estimates come from models trained on small public research datasets and are not medical advice or a diagnosis.</p>
        <p className="mt-1 font-medium text-ink">If you have chest pain, trouble breathing, fainting or other urgent symptoms, contact emergency services now.</p>
      </footer>
      <AssistantFab />
    </div>
  );
}
