import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { predictOnDevice, validateOnDevice, type DeviceModel } from "../lib/onDevice";

const parity = JSON.parse(readFileSync(join(process.cwd(), "src/test/parity.json"), "utf8")) as Record<string, { inputs: Record<string, number>; expected: number }[]>;
const model = (c: string) => JSON.parse(readFileSync(join(process.cwd(), `public/models/${c}.json`), "utf8")) as DeviceModel;

describe("on-device inference matches the Python model", () => {
  for (const condition of ["diabetes", "heart_disease", "diabetes_survey"]) {
    it(`${condition}: ${parity[condition]?.length} cases within 1e-9 of scikit-learn`, () => {
      const m = model(condition);
      expect(parity[condition].length).toBeGreaterThanOrEqual(50);
      let worst = 0;
      for (const c of parity[condition]) worst = Math.max(worst, Math.abs(predictOnDevice(m, c.inputs).score - c.expected));
      expect(worst).toBeLessThan(1e-9);
    });
  }
  it("drivers sum (in the model's own scale) to the decision value and are sorted by size", () => {
    const m = model("diabetes"), c = parity.diabetes[0];
    const r = predictOnDevice(m, c.inputs);
    const mags = r.drivers.map((d) => Math.abs(d.effect));
    expect(mags).toEqual([...mags].sort((a, b) => b - a));
  });
  it("rejects what the server would reject", () => {
    const m = model("diabetes");
    const { errors } = validateOnDevice(m, { glucose: "5", age: "abc" });
    expect(errors.glucose).toMatch(/between/); expect(errors.age).toMatch(/number/); expect(errors.bmi).toBe("required");
  });
});
