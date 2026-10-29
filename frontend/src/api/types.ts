export type ContentKind = "measured" | "ai_estimate" | "hypothetical" | "cohort_comparison";
export type Condition = "diabetes" | "heart_disease";
export type RiskBand = "low" | "moderate" | "high";

export interface Driver {
  feature: string; label: string; value: number; unit: string; effect: number; direction: "raises" | "lowers";
}
export interface Explanation {
  method: string; output: string; base_value: number; top_drivers: Driver[]; reference?: string; note: string;
}
export interface Trust {
  model_agreement: { logistic_regression: number; random_forest: number; difference_pp: number; level: "high" | "medium" | "low" };
  uncertainty_range: { low: number; high: number; method: string; note: string };
  out_of_distribution: { feature: string; value: number; training_range: [number, number] }[];
}
export interface Prediction {
  id: string; content_kind: ContentKind; condition: Condition; score: number; risk_band: RiskBand;
  model: { version: string; algorithm: string | null }; input_snapshot: Record<string, number>;
  explanation: Explanation | null; trust: Trust | null; limitations: string[] | null; created_at: string;
  input_sources?: Record<string, string>;
}
export interface Measurement {
  id: string; content_kind: "measured"; measurement_type: string; value: number; unit: string; recorded_at: string;
  source: string; validation_status: "valid" | "flagged" | "rejected"; flag_reason: string | null; created_at: string;
}
export interface Profile {
  content_kind: "measured"; email: string; display_name: string | null; date_of_birth: string | null; age: number | null;
  sex: "female" | "male" | "other" | null; height_cm: number | null; bmi: { value: number; source: string } | null;
}
export interface TrendPoint { recorded_at: string; value: number; unit: string; validation_status: string }
export interface DashboardData {
  profile: Profile; latest_measurements: Record<string, Measurement>; trend_series: Record<string, TrendPoint[]>;
  latest_predictions: Record<Condition, Prediction | null>; scenario_count: number; flagged_count: number;
  models_available: Condition[];
}
export interface TokenPair { access_token: string; refresh_token: string; token_type: string; expires_in: number }
