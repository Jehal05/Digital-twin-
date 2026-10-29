import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { api } from "../api/client";
import { session } from "../api/session";
import { STRINGS, type Key, type Locale } from "../i18n/strings";

export type ThemeChoice = "system" | "light" | "dark";
interface Prefs { theme: ThemeChoice; locale: Locale; reducedMotion: boolean }
interface Ctx extends Prefs {
  resolvedTheme: "light" | "dark";
  t(key: Key): string;
  update(patch: Partial<Prefs>): void;
  /** Called once after sign-in: local choices win and are pushed to the server; otherwise the server's are applied. */
  syncWithServer(): Promise<void>;
}
const C = createContext<Ctx | null>(null);
const KEY = "ht_prefs";

const read = (): Partial<Prefs> => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } };
const write = (p: Prefs) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable: the choice lasts for this visit */ } };
const systemDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

export function PrefsProvider({ children }: { children: ReactNode }) {
  const stored = useMemo(read, []);
  const [prefs, setPrefs] = useState<Prefs>({ theme: stored.theme ?? "system", locale: stored.locale ?? "en", reducedMotion: stored.reducedMotion ?? false });
  const [sysDark, setSysDark] = useState(systemDark);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)"), on = () => setSysDark(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  const resolvedTheme = prefs.theme === "system" ? (sysDark ? "dark" : "light") : prefs.theme;

  useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme = resolvedTheme; r.lang = prefs.locale; r.dataset.motion = prefs.reducedMotion ? "reduce" : "";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolvedTheme === "dark" ? "#091129" : "#2b4f9e");
  }, [resolvedTheme, prefs.locale, prefs.reducedMotion]);

  const push = useCallback((p: Prefs) => {
    if (!session.access) return;
    api.put("/preferences", { theme: p.theme, locale: p.locale, reduced_motion: p.reducedMotion }).catch(() => undefined);
  }, []);
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((cur) => { const next = { ...cur, ...patch }; write(next); push(next); return next; });
  }, [push]);
  const syncWithServer = useCallback(async () => {
    if (Object.keys(read()).length > 0) { push(prefs); return; }
    try {
      const s = await api.get<{ locale: Locale; theme: ThemeChoice; reduced_motion: boolean }>("/preferences");
      const next = { theme: s.theme, locale: s.locale, reducedMotion: s.reduced_motion };
      setPrefs(next); write(next);
    } catch { /* keep defaults */ }
  }, [prefs, push]);

  const t = useCallback((key: Key) => STRINGS[prefs.locale][key] ?? STRINGS.en[key], [prefs.locale]);
  const value = useMemo(() => ({ ...prefs, resolvedTheme, t, update, syncWithServer }), [prefs, resolvedTheme, t, update, syncWithServer]);
  return <C.Provider value={value}><MotionConfig reducedMotion={prefs.reducedMotion ? "always" : "user"}>{children}</MotionConfig></C.Provider>;
}

export function usePrefs(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("usePrefs must be used inside PrefsProvider");
  return c;
}
/** Components render in English if no provider is mounted (keeps isolated component tests simple). */
export function useT(): (key: Key) => string {
  const c = useContext(C);
  return c ? c.t : (key) => STRINGS.en[key];
}
