import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, setSessionExpiredHandler, setTokens } from "../api/client";
import { session } from "../api/session";
import { json } from "./fixtures";

const tokens = (n: string) => ({ access_token: `a${n}`, refresh_token: `r${n}`, token_type: "bearer", expires_in: 900 });

beforeEach(() => { session.clear(); setTokens(tokens("1")); });
afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("sends the bearer token and parses JSON", async () => {
    const f = vi.fn().mockResolvedValue(json({ ok: 1 }));
    vi.stubGlobal("fetch", f);
    expect(await api.get("/profile")).toEqual({ ok: 1 });
    expect((f.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe("Bearer a1");
  });

  it("turns the unified error shape into ApiError with field messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: { code: "validation_error", message: "Bad", fields: { glucose: "too low" } } }, 422)));
    await expect(api.post("/x", {})).rejects.toMatchObject({ status: 422, code: "validation_error", fields: { glucose: "too low" } });
  });

  it("reports a network failure as a friendly error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fail")));
    await expect(api.get("/x")).rejects.toBeInstanceOf(ApiError);
  });

  it("refreshes once on 401 and shares one refresh between parallel calls", async () => {
    let refreshes = 0;
    const f = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/auth/refresh")) { refreshes++; await new Promise((r) => setTimeout(r, 5)); return json(tokens("2")); }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === "Bearer a2" ? json({ ok: true }) : json({ error: { code: "unauthorized", message: "no", fields: {} } }, 401);
    });
    vi.stubGlobal("fetch", f);
    const [a, b] = await Promise.all([api.get("/dashboard"), api.get("/profile")]);
    expect(a).toEqual({ ok: true }); expect(b).toEqual({ ok: true });
    expect(refreshes).toBe(1);
    expect(session.refresh).toBe("r2");
  });

  it("signs the user out when the refresh fails", async () => {
    const expired = vi.fn(); setSessionExpiredHandler(expired);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/auth/refresh")
      ? json({ error: { code: "unauthorized", message: "no", fields: {} } }, 401)
      : json({ error: { code: "unauthorized", message: "no", fields: {} } }, 401)));
    await expect(api.get("/dashboard")).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalled(); expect(session.refresh).toBeNull();
  });

  it("keeps the saved session when refresh fails for a temporary reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/auth/refresh")
      ? json({ error: { code: "rate_limited", message: "slow down", fields: {} } }, 429)
      : json({ error: { code: "unauthorized", message: "no", fields: {} } }, 401)));
    await expect(api.get("/dashboard")).rejects.toMatchObject({ status: 401 });
    expect(session.refresh).toBe("r1");
  });
});
