import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useDashboard } from "../../auth/DataContext";
import type { Key } from "../../i18n/strings";
import { usePrefs } from "../../prefs/PrefsContext";
import { CommandPalette } from "./CommandPalette";
import { Button } from "../ui/Button";
import { ExplainerPanel } from "../explainer/ExplainerPanel";
import { Logo } from "./Logo";

const NAV: { to: string; key: Key }[] = [
  { to: "/", key: "nav.dashboard" }, { to: "/profile", key: "nav.data" }, { to: "/risk/diabetes", key: "nav.risk" }, { to: "/simulator", key: "nav.simulator" },
  { to: "/trends", key: "nav.trends" }, { to: "/reliability", key: "nav.reliability" }, { to: "/report", key: "nav.report" },
];
const STEPS: Key[] = ["step.1", "step.2", "step.3", "step.4", "step.5"];

function stepIndex(path: string, hasData: boolean, hasEstimate: boolean) {
  if (path.startsWith("/profile") || path.startsWith("/import")) return 0;
  if (path.startsWith("/risk")) return 2;
  if (path.startsWith("/simulator")) return 3;
  if (path.startsWith("/trends")) return 4;
  if (path.startsWith("/reliability")) return 1;
  if (hasEstimate) return 2;
  return hasData ? 1 : 0;
}

export function SummaryBar() {
  const { data } = useDashboard();
  const { t } = usePrefs();
  if (!data) return null;
  const p = data.profile, m = data.latest_measurements;
  const items: [string, string][] = [
    [t("sum.age"), p.age !== null ? String(p.age) : "—"],
    [t("sum.weight"), m.weight_kg ? `${m.weight_kg.value} kg` : "—"],
    [t("sum.bmi"), p.bmi ? `${p.bmi.value}` : "—"],
    [t("sum.glucose"), (m.glucose_2h_mgdl ?? m.glucose_mgdl) ? `${(m.glucose_2h_mgdl ?? m.glucose_mgdl)!.value} mg/dL` : "—"],
  ];
  const name = p.display_name || p.email.split("@")[0];
  return (
    <section aria-label="Summary" className="glass flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
      <p className="text-sm"><span className="text-muted">{t("hello")}</span> <strong>{name}</strong></p>
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
  const { t } = usePrefs();
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === current ? "step" : undefined}
          className={`rounded-full px-3 py-1.5 font-semibold ${i === current ? "bg-brand text-on-strong" : i < current ? "bg-brand-soft text-ink" : "bg-card/60 text-muted"}`}>
          {i + 1}. {t(s)}
        </li>
      ))}
    </ol>
  );
}

export function AppShell() {
  const { logout } = useAuth();
  const { data } = useDashboard();
  const { t } = usePrefs();
  const [paletteOpen, setPaletteOpen] = useState(0);
  const loc = useLocation();
  const here = NAV.find((n) => (n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to.split("/").slice(0, 2).join("/")))) ?? null;
  const pageName = here ? t(here.key) : loc.pathname.startsWith("/settings") ? t("nav.privacy") : "HealthTwin";
  const ownH1 = ["/reliability", "/import", "/report", "/settings"].some((x) => loc.pathname.startsWith(x));
  useEffect(() => { document.title = pageName === "HealthTwin" ? "HealthTwin" : `${pageName} · HealthTwin`; }, [pageName]);
  const hasEstimate = !!data && Object.values(data.latest_predictions).some(Boolean);
  const hasData = !!data && Object.keys(data.latest_measurements).length > 0;
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-4 py-4 md:px-6">
      <a href="#main" className="sr-only focus:not-sr-only focus:rounded focus:bg-card focus:p-2">{t("skip")}</a>
      <header className="glass no-print flex flex-wrap items-center gap-3 px-5 py-3">
        <div className="flex items-center gap-2.5"><Logo /><span className="text-lg font-bold tracking-tight">HealthTwin</span></div>
        <nav aria-label={t("nav.main")} className="order-3 flex w-full flex-wrap gap-1 md:order-none md:ml-4 md:w-auto">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"}
              className={({ isActive }) => `rounded-full px-3 py-1.5 text-sm font-medium ${isActive ? "bg-brand text-on-strong" : "hover:bg-brand-soft"}`}>{t(n.key)}</NavLink>
          ))}
        </nav>
        <button onClick={() => setPaletteOpen((n) => n + 1)} className="ml-auto hidden items-center gap-2 rounded-full border border-field bg-card/70 px-3 py-1.5 text-xs text-muted hover:bg-card md:inline-flex">{t("cmd.hint")} <kbd className="rounded bg-dim px-1.5 font-sans">Ctrl K</kbd></button>
        <NavLink to="/settings" className={({ isActive }) => `rounded-full px-3 py-1.5 text-sm font-medium ${isActive ? "bg-brand text-on-strong" : "hover:bg-brand-soft"}`}>{t("nav.privacy")}</NavLink>
        <Button variant="secondary" onClick={() => void logout()}>{t("nav.signout")}</Button>
      </header>
      <div className="no-print"><SummaryBar /></div>
      <section className="no-print" aria-label={t("journey")}><ProgressRail current={stepIndex(loc.pathname, hasData, hasEstimate)} /></section>
      <main id="main" className="flex-1" tabIndex={-1}>{!ownH1 && <h1 className="sr-only">{pageName}</h1>}<Outlet /></main>
      <footer className="pb-16 text-xs text-muted">
        <p>{t("footer.edu")}</p>
        <p className="mt-1 font-medium text-ink">{t("footer.urgent")}</p>
      </footer>
      <ExplainerPanel />
      <CommandPalette openSignal={paletteOpen} />
    </div>
  );
}
