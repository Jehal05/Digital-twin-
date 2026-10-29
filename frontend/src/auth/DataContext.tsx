import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type { DashboardData } from "../api/types";

interface Ctx { data: DashboardData | null; loading: boolean; error: ApiError | null; reload(): Promise<void> }
const DataCtx = createContext<Ctx | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await api.get<DashboardData>("/dashboard")); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e : new ApiError(0, "error", "Something went wrong.")); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return <DataCtx.Provider value={{ data, loading, error, reload }}>{children}</DataCtx.Provider>;
}

export function useDashboard(): Ctx {
  const c = useContext(DataCtx);
  if (!c) throw new Error("useDashboard must be used inside DashboardProvider");
  return c;
}
