import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardProvider } from "../auth/DataContext";
import { session } from "../api/session";
import { LineChart, Waterfall } from "../components/charts/Charts";
import { SimulatorPage } from "../pages/SimulatorPage";
import { dashboard, json, prediction } from "./fixtures";
import type { Scenario } from "../api/types";

afterEach(() => vi.unstubAllGlobals());

describe("charts", () => {
  it("LineChart repeats every point in a screen-reader table", () => {
    render(<LineChart title="T" xLabel="x" yLabel="y" points={[{ x: 0, y: 1 }, { x: 1, y: 3 }]} />);
    expect(screen.getByRole("img", { name: /2 points/ })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
  it("Waterfall describes direction in words, not only colour", () => {
    render(<Waterfall base={0.3} items={[{ label: "Glucose", value: 0.1 }, { label: "BMI", value: -0.05 }]} final={0.35} />);
    const label = screen.getByRole("img").getAttribute("aria-label")!;
    expect(label).toMatch(/Glucose adds 10\.0 points/); expect(label).toMatch(/BMI removes 5\.0 points/); expect(label).toMatch(/35\.0 percent/);
  });
});

describe("SimulatorPage", () => {
  const scenario: Scenario = { id: "s1", content_kind: "hypothetical", kind: "what_if", name: "What if", condition: "diabetes", target_score: null,
    changed_inputs: { bmi: 27 }, baseline: prediction, scenario: { ...prediction, id: "p2", score: 0.2, risk_band: "low" }, delta_pp: -11.8, note: "Hypothetical model output.", created_at: "" };

  function setup() {
    session.access = "t";
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/dashboard")) return json(dashboard({ latest_predictions: { diabetes: prediction, heart_disease: null } }));
      if (url.includes("/scenarios?")) return json({ items: [] });
      if (url.endsWith("/scenarios") && init?.method === "POST") return json(scenario, 201);
      return json({}, 404);
    }));
    render(<MemoryRouter><DashboardProvider><SimulatorPage /></DashboardProvider></MemoryRouter>);
    return calls;
  }

  it("only offers editable inputs and keeps the run disabled until something changes", async () => {
    setup();
    await screen.findByText("What-If Simulator");
    expect(screen.getAllByRole("slider").map((s) => s.id).filter((i) => i.startsWith("sl-")).sort()).toEqual(["sl-blood_pressure", "sl-bmi", "sl-glucose"]);
    expect(screen.getByText(/cannot be simulated/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run scenario/i })).toBeDisabled();
  });

  it("sends only the changed inputs, labels the result hypothetical and never touches the baseline", async () => {
    const calls = setup();
    await screen.findByText("What-If Simulator");
    const bmi = document.getElementById("sl-bmi") as HTMLInputElement;
    fireEvent.change(bmi, { target: { value: "27" } });
    const run = screen.getByRole("button", { name: /run scenario/i });
    await waitFor(() => expect(run).toBeEnabled());
    await userEvent.click(run);
    await screen.findByText(/change in this model/i);
    const post = calls.find((c) => c.url.endsWith("/scenarios") && c.init?.method === "POST")!;
    const body = JSON.parse(post.init!.body as string);
    expect(Object.keys(body.changed_inputs)).toEqual(["bmi"]);
    expect(body.baseline_prediction_id).toBe("p1");
    expect(screen.getAllByText("Hypothetical").length).toBeGreaterThan(0);
    expect(calls.some((c) => c.init?.method === "PUT")).toBe(false);
  });
});

describe("SimulatorPage for heart disease", () => {
  it("switches to heart, offers only blood pressure and cholesterol, and sends the heart condition", async () => {
    session.access = "t";
    const heart = { ...prediction, id: "h1", condition: "heart_disease" as const, score: 0.6, input_snapshot: { age: 58, sex: 1, cp: 4, trestbps: 150, chol: 260, fbs: 0, restecg: 0, thalach: 120, exang: 1, oldpeak: 2 } };
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/dashboard")) return json(dashboard({ models_available: ["diabetes", "heart_disease"], latest_predictions: { diabetes: prediction, heart_disease: heart } }));
      if (url.includes("/scenarios?")) return json({ items: [] });
      if (url.endsWith("/scenarios") && init?.method === "POST") return json({ id: "s", content_kind: "hypothetical", kind: "what_if", name: "x", condition: "heart_disease", target_score: null, changed_inputs: { trestbps: 130 }, baseline: heart, scenario: { ...heart, id: "h2", score: 0.5 }, delta_pp: -10, note: "n", created_at: "" }, 201);
      return json({}, 404);
    }));
    render(<MemoryRouter><DashboardProvider><SimulatorPage /></DashboardProvider></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Heart disease" }));
    await waitFor(() => expect(screen.getAllByRole("slider").map((s) => s.id).filter((i) => i.startsWith("sl-")).sort()).toEqual(["sl-chol", "sl-trestbps"]));
    expect(screen.getByText("Male")).toBeInTheDocument(); // fixed input shown in words
    fireEvent.change(document.getElementById("sl-trestbps")!, { target: { value: "130" } });
    await userEvent.click(screen.getByRole("button", { name: /run scenario/i }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/scenarios") && c.init?.method === "POST")).toBe(true));
    const post = calls.find((c) => c.url.endsWith("/scenarios") && c.init?.method === "POST")!;
    expect(JSON.parse(post.init!.body as string)).toMatchObject({ condition: "heart_disease", baseline_prediction_id: "h1", changed_inputs: { trestbps: 130 } });
  });
});
