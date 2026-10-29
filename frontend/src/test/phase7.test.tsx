import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthContext";
import { DashboardProvider } from "../auth/DataContext";
import { session } from "../api/session";
import { CommandPalette } from "../components/layout/CommandPalette";
import { AppShell } from "../components/layout/AppShell";
import { STRINGS } from "../i18n/strings";
import { PrefsProvider, usePrefs } from "../prefs/PrefsContext";
import { SettingsPage } from "../pages/SettingsPage";
import { dashboard, json } from "./fixtures";

beforeEach(() => { session.access = "tok"; localStorage.clear(); delete document.documentElement.dataset.theme; });
afterEach(() => vi.unstubAllGlobals());

function stubApi() {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/dashboard")) return json(dashboard());
    if (url.endsWith("/privacy/consents")) return json({ current: {}, history_count: 1, ai_explainer_available: false });
    if (url.endsWith("/preferences")) return json({ theme: "light", locale: "en", reduced_motion: false });
    return json({}, 404);
  }));
  return calls;
}
const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
const app = (ui: React.ReactNode) => render(<PrefsProvider><MemoryRouter><AuthProvider>{ui}</AuthProvider></MemoryRouter></PrefsProvider>);

describe("translations", () => {
  it("Hindi covers every English key, and keeps the safety wording", () => {
    expect(Object.keys(STRINGS.hi).sort()).toEqual(Object.keys(STRINGS.en).sort());
    for (const [k, v] of Object.entries(STRINGS.hi)) expect(v.trim(), k).not.toBe("");
    expect(STRINGS.hi["note.experimental"]).toContain("निदान नहीं");
    expect(STRINGS.hi["footer.urgent"]).toContain("112");
  });
});

describe("theme and language", () => {
  it("applies the chosen theme and language to the page and remembers them", async () => {
    stubApi();
    app(<SettingsPage />);
    await userEvent.click(await screen.findByLabelText("Dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await userEvent.selectOptions(screen.getByLabelText("Language"), "hi");
    expect(document.documentElement.lang).toBe("hi");
    expect(await screen.findByText("गोपनीयता और डेटा")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("ht_prefs")!)).toMatchObject({ theme: "dark", locale: "hi" });
  });

  it("'match my device' follows the operating system setting", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("dark"), addEventListener() {}, removeEventListener() {} }));
    function Probe() { return <p>{usePrefs().resolvedTheme}</p>; }
    render(<PrefsProvider><Probe /></PrefsProvider>);
    expect(screen.getByText("dark")).toBeInTheDocument();
  });

  it("saves changes to the server while signed in, and a local choice wins over the server's on a new sign-in", async () => {
    const calls = stubApi();
    localStorage.setItem("ht_prefs", JSON.stringify({ theme: "dark", locale: "en", reducedMotion: false }));
    function Sync() { const { syncWithServer } = usePrefs(); return <button onClick={() => void syncWithServer()}>sync</button>; }
    app(<Sync />);
    await userEvent.click(screen.getByText("sync"));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/preferences") && c.init?.method === "PUT")).toBe(true));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("reduced-motion preference is exposed to CSS", async () => {
    stubApi();
    app(<SettingsPage />);
    await userEvent.click(await screen.findByLabelText(/reduce motion/i));
    expect(document.documentElement.dataset.motion).toBe("reduce");
  });
});

describe("command palette", () => {
  const open = async () => {
    stubApi();
    app(<><CommandPalette /><Routes><Route path="*" element={<Where />} /></Routes></>);
    await userEvent.keyboard("{Control>}k{/Control}");
    return screen.findByRole("combobox");
  };

  it("opens with Ctrl+K, filters, and runs the highlighted command with Enter", async () => {
    const box = await open();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    await userEvent.type(box, "simul");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    expect(screen.getByTestId("where")).toHaveTextContent("/simulator");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves with the arrow keys, announces the active option and closes with Escape", async () => {
    const box = await open();
    await userEvent.keyboard("{ArrowDown}");
    const active = screen.getAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true")!;
    expect(box).toHaveAttribute("aria-activedescendant", active.id);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("can switch theme from the keyboard and says when nothing matches", async () => {
    const box = await open();
    await userEvent.type(box, "zzzz");
    expect(screen.getByText("No matches")).toBeInTheDocument();
    await userEvent.clear(box); await userEvent.type(box, "theme");
    await userEvent.keyboard("{Enter}");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("app shell", () => {
  it("shows translated navigation and safety notices", async () => {
    stubApi();
    localStorage.setItem("ht_prefs", JSON.stringify({ theme: "light", locale: "hi", reducedMotion: false }));
    render(<PrefsProvider><MemoryRouter><AuthProvider><DashboardProvider><Routes><Route element={<AppShell />}><Route index element={<p>x</p>} /></Route></Routes></DashboardProvider></AuthProvider></MemoryRouter></PrefsProvider>);
    expect(await screen.findByRole("link", { name: "डैशबोर्ड" })).toBeInTheDocument();
    expect(screen.getByText(/भारत में 112/)).toBeInTheDocument();
  });
});

describe("service worker", () => {
  const sw = readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8");
  it("never caches API responses or non-GET requests", () => {
    expect(sw).toMatch(/startsWith\("\/api\/"\)/);
    expect(sw).toMatch(/req\.method !== "GET"/);
    expect(sw).not.toMatch(/put\(req.*api/i);
  });
  it("manifest is installable", () => {
    const m = JSON.parse(readFileSync(resolve(__dirname, "../../public/manifest.webmanifest"), "utf8"));
    expect(m.display).toBe("standalone");
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });
});
