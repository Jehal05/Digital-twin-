import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { session } from "../api/session";
import { AuthProvider } from "../auth/AuthContext";
import { PrefsProvider } from "../prefs/PrefsContext";
import { DashboardProvider } from "../auth/DataContext";
import { ExplainerPanel } from "../components/explainer/ExplainerPanel";
import { ImportPage } from "../pages/ImportPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SharedPage } from "../pages/SharedPage";
import { dashboard, json, prediction } from "./fixtures";

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;
function mockFetch(...handlers: Handler[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    for (const h of handlers) { const r = await h(url, init); if (r) return r; }
    if (url.endsWith("/dashboard")) return json(dashboard({ latest_predictions: { diabetes: prediction, heart_disease: null } }));
    return json({ error: { code: "not_found", message: "nope", fields: {} } }, 404);
  }));
  return calls;
}
const file = (name: string, type: string) => new File(["x"], name, { type });
beforeEach(() => { session.access = "tok"; });
afterEach(() => vi.unstubAllGlobals());

const wrap = (ui: React.ReactNode) => render(<MemoryRouter><DashboardProvider>{ui}</DashboardProvider></MemoryRouter>);

describe("CSV import", () => {
  const csv = { layout: "wide", summary: { ok: 2, errors: 1 }, rows: [
    { line: 2, status: "ok", measurement_type: "steps", value: 8000, unit: "count", recorded_at: "2026-10-01T12:00:00Z", note: "No time or timezone given; assumed 12:00 UTC." },
    { line: 2, status: "ok", measurement_type: "sleep_hours", value: 7, unit: "h", recorded_at: "2026-10-01T12:00:00Z" },
    { line: 3, status: "error", measurement_type: "steps", message: "value must be a number" }] };

  it("shows problems, saves only valid rows and reports duplicates", async () => {
    const calls = mockFetch((u) => u.endsWith("/imports/csv/preview") ? json(csv) : undefined,
      (u) => u.endsWith("/imports/commit") ? json({ created: 1, skipped_duplicates: 1, flagged: 0, errors: [] }, 201) : undefined);
    wrap(<ImportPage />);
    await userEvent.upload(screen.getByLabelText(/choose a \.csv file/i), file("w.csv", "text/csv"));
    expect(await screen.findByText(/with problems/i)).toBeInTheDocument();
    expect(screen.getByText("value must be a number")).toBeInTheDocument();
    expect(screen.getByText(/assumed 12:00 UTC/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /save 2 valid rows/i }));
    expect(await screen.findByText(/Saved 1 reading/)).toBeInTheDocument();
    expect(screen.getByText(/1 already existed/)).toBeInTheDocument();
    const post = calls.find((c) => c.url.endsWith("/imports/commit"))!;
    const body = JSON.parse(post.init!.body as string);
    expect(body.source).toBe("csv"); expect(body.rows).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain("value must be");
  });

  it("sends the file as multipart without forcing a JSON content type", async () => {
    const calls = mockFetch((u) => u.endsWith("/imports/csv/preview") ? json(csv) : undefined);
    wrap(<ImportPage />);
    await userEvent.upload(screen.getByLabelText(/choose a \.csv file/i), file("w.csv", "text/csv"));
    await screen.findByText(/with problems/i);
    const c = calls.find((x) => x.url.endsWith("/csv/preview"))!;
    expect(c.init!.body).toBeInstanceOf(FormData);
    expect((c.init!.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("shows the server's reason when a file is rejected", async () => {
    mockFetch((u) => u.endsWith("/csv/preview") ? json({ error: { code: "invalid_file", message: "No date column found.", fields: {} } }, 422) : undefined);
    wrap(<ImportPage />);
    await userEvent.upload(screen.getByLabelText(/choose a \.csv file/i), file("w.csv", "text/csv"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No date column found.");
  });
});

describe("Lab report import", () => {
  const lab = { method: "ocr", ocr_confidence: 0.91, file_stored: false, detected_dates: [], ambiguous_dates_found: true, note: "",
    candidates: [{ measurement_type: "glucose_mgdl", value: 126, unit: "mg/dL", unit_found_in_text: true, snippet: "Glucose 126 mg/dL", confidence: "high" },
      { measurement_type: "cholesterol_mgdl", value: 210, unit: "mg/dL", unit_found_in_text: false, snippet: "Cholesterol 210", confidence: "low" }] };

  it("never saves without a date, lets the user correct values, and sends source=ocr", async () => {
    const calls = mockFetch((u) => u.endsWith("/lab-report/preview") ? json(lab) : undefined,
      (u) => u.endsWith("/imports/commit") ? json({ created: 1, skipped_duplicates: 0, flagged: 0, errors: [] }, 201) : undefined);
    wrap(<ImportPage />);
    await userEvent.upload(screen.getByLabelText(/choose a png/i), file("r.png", "image/png"));
    expect(await screen.findByText(/could be read two ways/i)).toBeInTheDocument();
    expect(screen.getByText(/no unit found in the text/i)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: /save 2 readings/i });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/date the sample/i), "2026-10-20");
    await userEvent.click(screen.getByLabelText("Include Cholesterol"));
    const glucose = screen.getByLabelText("Glucose (fasting/random) value");
    await userEvent.clear(glucose); await userEvent.type(glucose, "128");
    await userEvent.click(screen.getByRole("button", { name: /save 1 reading$/i }));
    await screen.findByText(/Saved 1 reading/);
    const body = JSON.parse(calls.find((c) => c.url.endsWith("/imports/commit"))!.init!.body as string);
    expect(body.source).toBe("ocr");
    expect(body.rows).toEqual([expect.objectContaining({ measurement_type: "glucose_mgdl", value: 128, unit: "mg/dL", ocr_confidence: 0.91 })]);
    expect(body.rows[0].recorded_at).toMatch(/^2026-10-20/);
  });

  it("offers detected dates as one-click suggestions and says nothing was found when it is empty", async () => {
    mockFetch((u) => u.endsWith("/lab-report/preview") ? json({ ...lab, candidates: [], detected_dates: ["2026-10-12"], ambiguous_dates_found: false }) : undefined);
    wrap(<ImportPage />);
    await userEvent.upload(screen.getByLabelText(/choose a png/i), file("r.png", "image/png"));
    expect(await screen.findByText(/No known values were found/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use 2026-10-12" }));
    expect(screen.getByLabelText(/date the sample/i)).toHaveValue("2026-10-12");
  });
});

describe("ExplainerPanel", () => {
  const consents = (ai: boolean, granted: boolean) => (u: string) => u.endsWith("/privacy/consents")
    ? json({ current: { ai_explainer: { granted, recorded_at: "" } }, history_count: 1, ai_explainer_available: ai }) : undefined;

  it("asks the server about the stored estimate and labels where the answer came from", async () => {
    const calls = mockFetch(consents(false, false), (u) => u.endsWith("/explain") ? json({ answer: "The estimate is 31.8%.", source: "template", refused: false, topic: "summary", disclaimer: "", cited_prediction_id: "p1" }) : undefined);
    wrap(<ExplainerPanel />);
    await screen.findByLabelText("AI explainer");
    await userEvent.click(screen.getByRole("button", { name: "AI explainer" }));
    await userEvent.click(await screen.findByRole("button", { name: "Summarise" }));
    expect(await screen.findByText("The estimate is 31.8%.")).toBeInTheDocument();
    expect(screen.getByText("Built from your stored results")).toBeInTheDocument();
    expect(JSON.parse(calls.find((c) => c.url.endsWith("/explain"))!.init!.body as string)).toEqual({ prediction_id: "p1", topic: "summary" });
    expect(screen.queryByLabelText("Ask a question")).not.toBeInTheDocument();
    expect(await screen.findByText(/no AI service is configured/i)).toBeInTheDocument();
  });

  it("offers free text only when the server has a provider and the user has consented", async () => {
    mockFetch(consents(true, true));
    wrap(<ExplainerPanel />);
    await screen.findByLabelText("AI explainer");
    await userEvent.click(screen.getByRole("button", { name: "AI explainer" }));
    expect(await screen.findByLabelText("Ask a question")).toBeInTheDocument();
  });
});

describe("SharedPage", () => {
  const renderShared = () => render(<MemoryRouter initialEntries={["/shared/abc"]}><Routes><Route path="/shared/:token" element={<SharedPage />} /></Routes></MemoryRouter>);

  it("shows the read-only report without sending any credentials", async () => {
    const calls = mockFetch((u) => u.includes("/shared/abc") ? json({ generated_at: new Date().toISOString(), disclaimer: "Not a diagnosis.", sections: ["measurements"], shared: true,
      measurements: [{ measurement_type: "weight_kg", unit: "kg", count: 3, first: 82, latest: 80, min: 80, max: 82, latest_at: new Date().toISOString(), sources: ["manual"] }], measurement_window_days: 90 }) : undefined);
    renderShared();
    expect(await screen.findByText("Health summary for a visit")).toBeInTheDocument();
    expect(screen.getByText(/80 kg/)).toBeInTheDocument();
    expect((calls[0].init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
  });

  it("shows one neutral message for expired, revoked and unknown links", async () => {
    mockFetch(() => json({ error: { code: "not_found", message: "This link is not available.", fields: {} } }, 404));
    renderShared();
    expect(await screen.findByRole("alert")).toHaveTextContent("This link is not available.");
  });
});

describe("SettingsPage", () => {
  it("only enables account deletion after a password and an explicit confirmation", async () => {
    const calls = mockFetch((u) => u.endsWith("/privacy/consents") ? json({ current: {}, history_count: 1, ai_explainer_available: false }) : undefined,
      (u, i) => u.endsWith("/privacy/account") && i?.method === "DELETE" ? new Response(null, { status: 202 }) : undefined);
    render(<PrefsProvider><MemoryRouter><AuthProvider><SettingsPage /></AuthProvider></MemoryRouter></PrefsProvider>);
    const btn = await screen.findByRole("button", { name: /delete everything/i });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/confirm with your password/i), "Secret-pass-123");
    expect(btn).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/i understand this is permanent/i));
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/privacy/account") && c.init?.method === "DELETE")).toBe(true));
    expect(JSON.parse(calls.find((c) => c.init?.method === "DELETE")!.init!.body as string)).toEqual({ password: "Secret-pass-123" });
  });

  it("records consent changes through the API", async () => {
    const calls = mockFetch((u, i) => u.endsWith("/privacy/consents") && i?.method === "POST" ? json({}, 201) : undefined,
      (u) => u.endsWith("/privacy/consents") ? json({ current: { ai_explainer: { granted: false, recorded_at: "" } }, history_count: 1, ai_explainer_available: true }) : undefined);
    render(<PrefsProvider><MemoryRouter><AuthProvider><SettingsPage /></AuthProvider></MemoryRouter></PrefsProvider>);
    const box = await screen.findByLabelText(/allow the ai explainer/i);
    await waitFor(() => expect(box).toBeEnabled());
    await userEvent.click(box);
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    expect(JSON.parse(calls.find((c) => c.init?.method === "POST")!.init!.body as string)).toEqual({ consent_type: "ai_explainer", granted: true });
  });
});
