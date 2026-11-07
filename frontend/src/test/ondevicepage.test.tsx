import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDeviceModelCache } from "../lib/onDevice";
import { OnDevicePage } from "../pages/OnDevicePage";
import { json } from "./fixtures";

const parity = JSON.parse(readFileSync(join(process.cwd(), "src/test/parity.json"), "utf8"));
const modelJson = (c: string) => JSON.parse(readFileSync(join(process.cwd(), `public/models/${c}.json`), "utf8"));
afterEach(() => { vi.unstubAllGlobals(); clearDeviceModelCache(); });

describe("OnDevicePage", () => {
  it("calculates the same number as the Python model and calls only the static model file, never the API", async () => {
    const fetchMock = vi.fn(async (url: string) => json(modelJson(String(url).includes("diabetes") ? "diabetes" : "diabetes")));
    vi.stubGlobal("fetch", fetchMock);
    // choose a parity case with no missing inputs
    const c = parity.diabetes.find((x: { inputs: Record<string, number | null> }) => Object.values(x.inputs).every((v) => v !== null));
    render(<OnDevicePage />);
    await screen.findByRole("button", { name: /calculate on this device/i });
    for (const [k, v] of Object.entries(c.inputs as Record<string, number>)) {
      const model = modelJson("diabetes"); const label = model.schema[k].label as string;
      const el = screen.getAllByRole("spinbutton").find((e) => (e.previousElementSibling?.textContent ?? "").toLowerCase().startsWith(label.slice(0, 6).toLowerCase())) ;
      if (el) await userEvent.type(el, String(v));
    }
    await userEvent.click(screen.getByRole("button", { name: /calculate on this device/i }));
    await waitFor(() => expect(screen.getByTestId("device-score")).toBeInTheDocument());
    const shown = Number(screen.getByTestId("device-score").textContent!.replace("%", ""));
    expect(shown).toBeCloseTo(c.expected * 100, 1);
    expect(screen.getByTestId("zero-upload")).toHaveTextContent(/requests made while calculating: 0/);
    expect(screen.getAllByText(/not a diagnosis/i).length).toBeGreaterThan(0);
    for (const call of fetchMock.mock.calls) expect(String(call[0])).toMatch(/^\/models\//);
  });
  it("tells the person what to do when the model file cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 404 })));
    render(<OnDevicePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/open this page once while online/i);
  });
});
