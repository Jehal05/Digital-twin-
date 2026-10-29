import { session } from "./session";
import type { TokenPair } from "./types";

const BASE = (import.meta.env.VITE_API_BASE ?? "") + "/api/v1";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

type Listener = () => void;
let onExpired: Listener = () => {};
export const setSessionExpiredHandler = (fn: Listener) => { onExpired = fn; };

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time: parallel 401s share the same attempt, so the rotating refresh token is never reused. */
export function refreshSession(): Promise<boolean> {
  const token = session.refresh;
  if (!token) return Promise.resolve(false);
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: token }) });
      if (res.status === 401 || res.status === 403) { session.clear(); return false; }   // definitively invalid
      if (!res.ok) return false;                                                          // 429/5xx: keep the token, try again later
      setTokens(await res.json());
      return true;
    } catch { return false; } finally { refreshing = null; }
  })();
  return refreshing;
}

export function setTokens(t: TokenPair) { session.access = t.access_token; session.refresh = t.refresh_token; }

async function toError(res: Response): Promise<ApiError> {
  try {
    const b = await res.json();
    return new ApiError(res.status, b.error?.code ?? "error", b.error?.message ?? res.statusText, b.error?.fields ?? {});
  } catch { return new ApiError(res.status, "error", res.statusText || "Request failed"); }
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (session.access) headers.Authorization = `Bearer ${session.access}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "network", "Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 401 && retry && session.refresh && !path.startsWith("/auth/")) {
    if (await refreshSession()) return request<T>(method, path, body, false);
    onExpired();
  }
  if (!res.ok) throw await toError(res);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T = void>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  upload: <T>(path: string, file: File) => { const f = new FormData(); f.append("file", file); return request<T>("POST", path, f); },
  /** Authenticated download (an <a href> cannot send the bearer token). */
  download: async (path: string): Promise<Blob> => {
    const call = () => fetch(`${BASE}${path}`, { headers: session.access ? { Authorization: `Bearer ${session.access}` } : {} });
    let res = await call();
    if (res.status === 401 && session.refresh && (await refreshSession())) res = await call();
    if (!res.ok) throw await toError(res);
    return res.blob();
  },
};
