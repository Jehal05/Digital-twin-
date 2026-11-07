import { describe, expect, it } from "vitest";
import { SURVEY_FIELDS, prefillSurvey } from "../components/dashboard/EstimateForm";
import { featureLabel, featureValue } from "../lib/format";

describe("lifestyle survey model inputs", () => {
  it("has the 16 inputs the server model expects, with plain-language options", () => {
    expect(SURVEY_FIELDS).toHaveLength(16);
    expect(SURVEY_FIELDS.find((f) => f.name === "age_band")?.options).toHaveLength(13);
  });
  it("never shows raw codes", () => {
    expect(featureValue("smoker", 1)).toBe("Yes");
    expect(featureValue("age_band", 10)).toBe("65 to 69");
    expect(featureValue("general_health", 4)).toBe("Fair");
    expect(featureLabel("heavy_alcohol")).toBe("Heavy drinking");
  });
  it("prefills the age band from the profile age", () => {
    const d = { latest_measurements: {}, profile: { age: 52, sex: "male", bmi: null } } as never;
    expect(prefillSurvey(d).values).toMatchObject({ age_band: "7", sex: "1" });
  });
});
