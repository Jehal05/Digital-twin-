import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDeviceModelCache } from "../lib/onDevice";
import { PERSONAS, RANGE, anomalyReason, generate } from "../lib/simulation";
import { VirtualPatientPage } from "../pages/VirtualPatientPage";
import { json } from "./fixtures";

const modelJson = (c: string) => JSON.parse(readFileSync(join(process.cwd(), `public/models/${c}.json`), "utf8"));
afterEach(() => { vi.unstubAllGlobals(); clearDeviceModelCache(); });

describe("simulation engine", () => {
  it("is deterministic for a seed and stays inside plausible ranges", () => {
    for (const p of PERSONAS) {
      const a = generate(p, 90), b = generate(p, 90);
      expect(a).toEqual(b);
      for (const r of a) { expect(r.value).toBeGreaterThanOrEqual(RANGE[r.series][0]); expect(r.value).toBeLessThanOrEqual(RANGE[r.series][1]); }
    }
  });
  it("the slow-drift patient really drifts and the improving patient really improves", () => {
    const g = (id: string, d: number) => generate(PERSONAS.find((p) => p.id === id)!, 90).filter((r) => r.series === "glucose_2h_mgdl" && r.day >= d - 5 && r.day <= d + 5).reduce((s, r) => s + r.value, 0) / 11;
    expect(g("drift", 85)).toBeGreaterThan(g("drift", 5) + 25);
    expect(g("recovery", 85)).toBeLessThan(g("recovery", 5) - 25);
  });
  it("flags every planted glitch with the server's jump rule, and ordinary days stay quiet", () => {
    const p = PERSONAS[0], r = generate(p, 90);
    const glitch = r.find((x) => x.planted)!;
    expect(glitch.flagged).toBe(true);
    expect(r.filter((x) => x.flagged && !x.planted && x.day !== glitch.day + 1).length).toBeLessThanOrEqual(2);   // day after a glitch also jumps back
    expect(anomalyReason("bmi", 30, 25)).toMatch(/jump/);
    expect(anomalyReason("bmi", 25.5, 25)).toBeNull();
    expect(anomalyReason("bmi", 25, null)).toBeNull();
  });
});

describe("VirtualPatientPage", () => {
  it("labels everything simulated, advances day by day and shows flagged glitches", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) => json(modelJson(String(u).includes("heart") ? "heart_disease" : "diabetes"))));
    render(<VirtualPatientPage />);
    expect(screen.getByTestId("simulated-badge")).toHaveTextContent(/simulated patient · not real data/i);
    const next = await screen.findByRole("button", { name: /next day/i });
    await waitFor(() => expect(next).toBeEnabled());
    await userEvent.click(next);
    expect(screen.getByTestId("sim-day")).toHaveTextContent("Day 1 of 90");
    const slider = screen.getByRole("slider", { name: /simulation day/i });
    const glitchDay = generate(PERSONAS[0], 90).find((r) => r.planted)!.day;
    fireEvent.change(slider, { target: { value: "90" } });      // jump to day 90 -> glitch already happened
    expect(screen.getByTestId("anomalies")).toHaveTextContent(new RegExp(`Day ${glitchDay}:`));
    expect(screen.getAllByText(/not a diagnosis/i).length).toBeGreaterThan(0);
  });
});
