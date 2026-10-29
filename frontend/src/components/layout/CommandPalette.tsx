import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import type { Key } from "../../i18n/strings";
import { usePrefs } from "../../prefs/PrefsContext";

interface Cmd { id: string; label: string; run(): void }
const PAGES: [string, Key][] = [["/", "nav.dashboard"], ["/profile", "nav.data"], ["/risk/diabetes", "nav.risk"], ["/simulator", "nav.simulator"],
  ["/trends", "nav.trends"], ["/reliability", "nav.reliability"], ["/report", "nav.report"], ["/import", "nav.data"], ["/settings", "nav.privacy"]];

/** Ctrl/⌘ + K. Keyboard-complete combobox: type to filter, arrows to move, Enter to run, Escape to close. */
export function CommandPalette({ openSignal }: { openSignal?: number }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(""), [i, setI] = useState(0);
  const nav = useNavigate();
  const { logout } = useAuth();
  const { t, theme, locale, update } = usePrefs();
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);

  const cmds = useMemo<Cmd[]>(() => [
    ...PAGES.map(([to, k], n): Cmd => ({ id: `go${n}`, label: to === "/import" ? `${t("nav.data")}: Import` : t(k), run: () => nav(to) })),
    { id: "theme", label: t("cmd.theme"), run: () => update({ theme: theme === "dark" ? "light" : "dark" }) },
    { id: "lang", label: t("cmd.language"), run: () => update({ locale: locale === "en" ? "hi" : "en" }) },
    { id: "print", label: t("cmd.print"), run: () => { nav("/report"); setTimeout(() => window.print(), 600); } },
    { id: "out", label: t("nav.signout"), run: () => void logout() },
  ], [t, nav, theme, locale, update, logout]);
  const shown = cmds.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()));

  const close = () => { setOpen(false); setQ(""); setI(0); (opener.current as HTMLElement | null)?.focus?.(); };
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); opener.current = document.activeElement; setOpen((o) => !o); } };
    window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on);
  }, []);
  useEffect(() => { if (openSignal) { opener.current = document.activeElement; setOpen(true); } }, [openSignal]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  if (!open) return null;

  const run = (c?: Cmd) => { if (!c) return; close(); c.run(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(shown.length - 1, x + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); run(shown[i]); }
    else if (e.key === "Tab") { e.preventDefault(); }  // focus stays in the dialog
  };
  return (
    <div className="no-print fixed inset-0 z-50 grid place-items-start bg-black/40 px-4 pt-[15vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label={t("cmd.title")} className="glass mx-auto w-full max-w-lg p-3" onKeyDown={onKey}>
        <input ref={input} role="combobox" aria-expanded="true" aria-controls="cmd-list" aria-autocomplete="list" aria-activedescendant={shown[i] ? `cmd-${shown[i].id}` : undefined}
          value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} placeholder={t("cmd.placeholder")} aria-label={t("cmd.placeholder")}
          className="w-full rounded-xl border border-field bg-card px-3 py-2 text-sm text-ink placeholder:text-muted" />
        <ul id="cmd-list" role="listbox" aria-label={t("cmd.title")} className="mt-2 max-h-72 overflow-auto">
          {shown.length === 0 && <li className="p-3 text-sm text-muted">{t("cmd.none")}</li>}
          {shown.map((c, n) => (
            <li key={c.id} id={`cmd-${c.id}`} role="option" aria-selected={n === i} onMouseEnter={() => setI(n)} onClick={() => run(c)}
              className={`cursor-pointer rounded-lg px-3 py-2 text-sm ${n === i ? "bg-brand text-on-strong" : ""}`}>{c.label}</li>))}
        </ul>
      </div>
    </div>
  );
}
