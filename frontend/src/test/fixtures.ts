import type { DashboardData, Prediction } from "../api/types";

export const prediction: Prediction = {
  id: "p1", content_kind: "ai_estimate", condition: "diabetes", score: 0.3176, risk_band: "moderate",
  model: { version: "1.0.0", algorithm: "logistic_regression" },
  input_snapshot: { glucose: 132, bmi: 30.8, age: 38, pregnancies: 2, blood_pressure: 78 },
  explanation: { method: "shap", output: "probability", base_value: 0.35, note: "n",
    top_drivers: [{ feature: "glucose", label: "2-hour plasma glucose", value: 132, unit: "mg/dL", effect: 0.118, direction: "raises" }] },
  trust: { model_agreement: { logistic_regression: 0.32, random_forest: 0.2, difference_pp: 12, level: "medium" },
    uncertainty_range: { low: 0.27, high: 0.36, method: "bootstrap", note: "" }, out_of_distribution: [] },
  limitations: ["Experimental model estimate, not a diagnosis."], created_at: new Date().toISOString(),
};

export const dashboard = (over: Partial<DashboardData> = {}): DashboardData => ({
  profile: { content_kind: "measured", email: "a@example.com", display_name: "Asha", date_of_birth: "1988-05-01", age: 38, sex: "female", height_cm: 165, bmi: null },
  latest_measurements: {}, trend_series: {}, latest_predictions: { diabetes: null, heart_disease: null },
  scenario_count: 0, flagged_count: 0, models_available: ["diabetes"], ...over,
});

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
