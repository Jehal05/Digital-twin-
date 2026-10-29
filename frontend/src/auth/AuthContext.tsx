import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, refreshSession, setSessionExpiredHandler, setTokens } from "../api/client";
import { session } from "../api/session";
import type { TokenPair } from "../api/types";

type Status = "loading" | "anonymous" | "authenticated";
interface Ctx {
  status: Status;
  login(email: string, password: string): Promise<void>;
  register(input: { email: string; password: string; display_name?: string; ai_explainer: boolean }): Promise<void>;
  logout(): Promise<void>;
}
const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    setSessionExpiredHandler(() => setStatus("anonymous"));
    let cancelled = false;
    (async () => {
      const ok = session.refresh ? await refreshSession() : false;
      if (!cancelled) setStatus(ok ? "authenticated" : "anonymous");
    })();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setTokens(await api.post<TokenPair>("/auth/login", { email, password }));
    setStatus("authenticated");
  }, []);

  const register = useCallback(async (i: { email: string; password: string; display_name?: string; ai_explainer: boolean }) => {
    const consents = [{ type: "data_processing", granted: true }, { type: "ai_explainer", granted: i.ai_explainer }];
    const body: Record<string, unknown> = { email: i.email, password: i.password, consents };
    if (i.display_name) body.display_name = i.display_name;
    setTokens(await api.post<TokenPair>("/auth/register", body));
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    const token = session.refresh;
    session.clear();
    setStatus("anonymous");
    if (token) { try { await api.post("/auth/logout", { refresh_token: token }); } catch { /* already signed out locally */ } }
  }, []);

  const value = useMemo(() => ({ status, login, register, logout }), [status, login, register, logout]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): Ctx {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}
