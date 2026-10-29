import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RiskGauge } from "../components/dashboard/RiskGauge";
import { DiseaseCard } from "../components/dashboard/DiseaseCard";
import { EstimateForm, prefill } from "../components/dashboard/EstimateForm";
import { DigitalTwin } from "../components/twin/DigitalTwin";
import { AuthPage } from "../pages/AuthPage";
import { AuthProvider } from "../auth/AuthContext";
import { dashboard, json, prediction } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("RiskGauge", () => {
  it("shows the number, the experimental label and the model range", () => {
    render(<RiskGauge p={prediction} />);
    expect(screen.getByTestId("gauge-value")).toHaveTextContent("31.8%");
    expect(screen.getAllByText(/not a diagnosis/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/27% to 36%/)).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuemin", "0");
  });
});

describe("DiseaseCard", () => {
  it("says honestly when a model is not trained", () => {
    render(<DiseaseCard condition="heart_disease" prediction={null} available={false} active={false} onSelect={() => {}} onRun={() => {}} />);
    expect(screen.getByText(/not available right now/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /get estimate/i })).toBeDisabled();
  });
});

describe("EstimateForm", () => {
  it("prefills from the dashboard and tells the user where each value came from", () => {
    const d = dashboard({ latest_measurements: { glucose_2h_mgdl: { id: "m", content_kind: "measured", measurement_type: "glucose_2h_mgdl", value: 121, unit: "mg/dL", recorded_at: new Date().toISOString(), source: "manual", validation_status: "valid", flag_reason: null, created_at: "" } } });
    const { values, sources } = prefill(d);
    expect(values.glucose).toBe("121"); expect(values.age).toBe("38"); expect(sources.glucose).toMatch(/2-hour test/);
    expect(values.pregnancies).toBeUndefined(); // never guessed
  });

  it("never prefills the model's glucose from a fasting reading and says why", () => {
    const m = { id: "m", content_kind: "measured" as const, measurement_type: "glucose_mgdl", value: 95, unit: "mg/dL", recorded_at: new Date().toISOString(), source: "manual", validation_status: "valid" as const, flag_reason: null, created_at: "" };
    const d = dashboard({ latest_measurements: { glucose_mgdl: m } });
    expect(prefill(d).values.glucose).toBeUndefined();
    render(<EstimateForm data={d} onDone={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("note")).toHaveTextContent(/2-hour glucose tolerance test value/);
  });

  it("blocks submission with clear messages when values are missing or out of range", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    render(<EstimateForm data={dashboard()} onDone={() => {}} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /estimate/i }));
    expect((await screen.findAllByText(/enter a number/i)).length).toBeGreaterThan(0);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("DigitalTwin", () => {
  it("summarises estimates in text for screen readers and marks the untrained model", () => {
    render(<DigitalTwin predictions={{ diabetes: prediction, heart_disease: null }} available={["diabetes"]} onSelect={() => {}} onRun={() => {}} />);
    const s = screen.getByTestId("twin-summary").textContent!;
    expect(s).toContain("Diabetes: 32%"); expect(s).toContain("Heart disease: model not available");
    expect(screen.getByText(/symbolic/i)).toBeInTheDocument();
  });
});

describe("AuthPage", () => {
  const renderAuth = () => { vi.stubGlobal("fetch", vi.fn()); return render(<MemoryRouter><AuthProvider><AuthPage /></AuthProvider></MemoryRouter>); };

  it("requires data-processing consent before creating an account", async () => {
    renderAuth();
    await waitFor(() => screen.getByRole("tab", { name: /create account/i }));
    await userEvent.click(screen.getByRole("tab", { name: /create account/i }));
    await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "Correct-horse-9");
    await userEvent.click(screen.getByRole("button", { name: /^create account$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/agree/i);
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/auth/register"), expect.anything());
  });

  it("shows the server's message when sign-in fails", async () => {
    renderAuth();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(json({ error: { code: "invalid_credentials", message: "Incorrect email or password.", fields: {} } }, 401));
    await userEvent.type(await screen.findByLabelText("Email"), "a@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "whatever-123456");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
  });
});

describe("EstimateForm for heart disease", () => {
  it("posts to the heart endpoint with chosen categories and the profile prefill", async () => {
    const f = vi.fn(async () => json({ ...prediction, condition: "heart_disease" }, 201)); vi.stubGlobal("fetch", f);
    const d = dashboard(); d.profile = { ...d.profile, age: 58, sex: "male" };
    const done = vi.fn();
    render(<EstimateForm condition="heart_disease" data={d} onDone={done} onCancel={() => {}} />);
    expect(screen.getByRole("form", { name: /heart disease estimate inputs/i })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/chest pain type/i), "4");
    await userEvent.type(screen.getByLabelText(/resting systolic/i), "140");
    await userEvent.type(screen.getByLabelText(/serum cholesterol/i), "240");
    await userEvent.selectOptions(screen.getByLabelText(/fasting blood sugar/i), "0");
    await userEvent.selectOptions(screen.getByLabelText(/resting ecg/i), "0");
    await userEvent.type(screen.getByLabelText(/maximum heart rate/i), "120");
    await userEvent.selectOptions(screen.getByLabelText(/brought on by exercise/i), "1");
    await userEvent.type(screen.getByLabelText(/st depression/i), "2");
    await userEvent.click(screen.getByRole("button", { name: /get estimate/i }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/predictions/heart-disease");
    expect(JSON.parse(init.body as string).features).toMatchObject({ age: 58, sex: 1, cp: 4, trestbps: 140, chol: 240, thalach: 120, exang: 1, oldpeak: 2 });
  });

  it("asks for a choice instead of guessing a category", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    render(<EstimateForm condition="heart_disease" data={dashboard()} onDone={() => {}} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /get estimate/i }));
    expect((await screen.findAllByText(/choose an option/i)).length).toBeGreaterThan(0);
    expect(f).not.toHaveBeenCalled();
  });
});
