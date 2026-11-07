import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Futures } from "../components/dashboard/Futures";
import { IconArray } from "../components/dashboard/IconArray";
import { json, prediction } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("IconArray", () => {
  it("draws 100 icons, the filled count matching the estimate, and describes it in words", () => {
    render(<IconArray p={{ ...prediction, score: 0.32, trust: { ...prediction.trust!, uncertainty_range: { low: 0.27, high: 0.36, method: "venn_abers", note: "" } } }} />);
    const svg = screen.getByTestId("icon-array");
    expect(svg.querySelectorAll("circle")).toHaveLength(100);
    expect(svg.querySelectorAll('[data-kind="yes"]')).toHaveLength(27);       // the estimate's lower bound is solid
    expect(svg.querySelectorAll('[data-kind="maybe"]')).toHaveLength(9);      // 27 to 36 is shown dashed
    expect(svg.getAttribute("aria-label")).toMatch(/about 32 .* The range is 27 to 36 out of 100/);
    expect(screen.getAllByText(/not a diagnosis/i).length).toBeGreaterThan(0);
  });
  it("uses the survey outcome wording for the survey model", () => {
    render(<IconArray p={{ ...prediction, condition: "diabetes_survey", score: 0.1 }} />);
    expect(screen.getByTestId("icon-array").getAttribute("aria-label")).toMatch(/reported a diabetes diagnosis/);
  });
});

describe("Futures", () => {
  it("shows both hypothetical paths, their assumptions and an accessible table", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ months: 6, note: "Hypothetical paths, not predictions.",
      carry_on: { label: "Carry on as now", scores: [0.32, 0.33, 0.34, 0.35, 0.36, 0.37, 0.38], assumptions: [{ input: "bmi", assumption: "held constant (1 measurement)" }] },
      improve: { label: "Improve habits", scores: [0.32, 0.3, 0.28, 0.26, 0.24, 0.22, 0.2], changes: { bmi: 27 }, reaches_target: true, assumptions: [{ input: "bmi", assumption: "moves evenly over 6 months" }] } })));
    render(<Futures p={prediction} condition="diabetes" />);
    await userEvent.click(screen.getByRole("button", { name: /show both futures/i }));
    await waitFor(() => expect(screen.getByTestId("futures")).toBeInTheDocument());
    expect(screen.getByTestId("futures")).toHaveTextContent(/32\.0% → 38\.0%/);
    expect(screen.getByTestId("futures")).toHaveTextContent(/32\.0% → 20\.0%/);
    expect(screen.getByRole("img", { name: /Carry on as now ends at 38\.0 percent/ })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(8);
    expect(screen.getByText(/not predictions/i)).toBeInTheDocument();
  });
});
