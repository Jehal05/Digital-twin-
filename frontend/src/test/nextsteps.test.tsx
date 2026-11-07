import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckNext, Counterfactual } from "../components/dashboard/NextSteps";
import { json, prediction } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("CheckNext", () => {
  it("lists inputs in rank order with the label and the honest note", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ baseline_band: "moderate", method: "m", note: "Experimental model estimate, not a diagnosis.",
      inputs: [{ feature: "glucose", label: "Glucose", value: 132, typical_swing_pp: 14.2, range_pp: [10, 60], chance_band_changes: 0.7, rank: 1 },
               { feature: "bmi", label: "BMI", value: 30.8, typical_swing_pp: 5, range_pp: [20, 40], chance_band_changes: 0.2, rank: 2 }] })));
    render(<CheckNext p={prediction} />);
    expect(await screen.findByText(/1\. /)).toHaveTextContent(/glucose/i);
    expect(screen.getByText(/risk band would change for 70%/)).toBeInTheDocument();
    expect(screen.getByText(/not a diagnosis/i)).toBeInTheDocument();
  });
});

describe("Counterfactual", () => {
  it("shows the hypothetical change and labels it hypothetical", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ feasible: true, changes: { bmi: 27 }, estimated_score: 0.19, baseline_score: 0.3176, current_band: "moderate",
      target_band: "low", band_edge: 0.2, note: "Model-suggested hypothetical." })));
    render(<Counterfactual p={prediction} condition="diabetes" />);
    await userEvent.click(screen.getByRole("button", { name: /find the smallest change/i }));
    await waitFor(() => expect(screen.getByTestId("counterfactual")).toHaveTextContent(/31\.8% → 19\.0%/));
    expect(screen.getByTestId("counterfactual")).toHaveTextContent(/27/);
    expect(screen.getAllByText(/hypothetical/i).length).toBeGreaterThan(0);
  });
  it("does not offer a search when already low", () => {
    render(<Counterfactual p={{ ...prediction, risk_band: "low" }} condition="diabetes" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
