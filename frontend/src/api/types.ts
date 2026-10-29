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

export interface Scenario {
  id: string; content_kind: "hypothetical"; kind: "what_if" | "goal_plan"; name: string; condition: Condition;
  target_score: number | null; changed_inputs: Record<string, number>; baseline: Prediction; scenario: Prediction;
  delta_pp: number; note: string; created_at: string;
}
export interface GoalPlan {
  content_kind: "hypothetical"; condition: Condition; target_score: number; baseline_score: number; feasible: boolean;
  changes: Record<string, number>; estimated_score: number; candidates_evaluated: number;
  constraints: Record<string, { max_decrease: number; floor: number }>; locked_inputs: string[]; note: string;
  message?: string; scenario?: Scenario;
}
export interface CohortPercentile { percentile: number; label: string; unit: string; outside_cohort_range: boolean; cohort: string; note: string }
export interface EvalMetrics {
  primary_algorithm: string; selection_rule: string; operating_threshold: number;
  split: { train_rows: number; test_rows: number };
  models: Record<string, { is_primary: boolean; cv_roc_auc_train: number; cv_roc_auc_std: number;
    test: { roc_auc: number; brier_score: number; roc_curve: { fpr: number[]; tpr: number[] };
      calibration_curve: { mean_predicted: number[]; fraction_positive: number[] }; calibration_gap: { mean_abs: number; max_abs: number };
      at_operating_threshold: { threshold: number; accuracy: number; sensitivity: number; specificity: number; precision: number;
        confusion_matrix: { tn: number; fp: number; fn: number; tp: number } } } }>;
  permutation_importance: { feature: string; mean_auc_drop: number; std: number }[];
  trust_meter_on_test: { mean_bootstrap_range_width: number; mean_lr_rf_disagreement_pp: number; share_disagreeing_over_10pp: number };
  data: { rows: number; positives: number; zeros_treated_as_missing: Record<string, number> };
}
export interface EvalItem {
  condition: Condition; version: string; primary_algorithm: string; metrics: EvalMetrics; model_card_markdown: string;
  intended_use: string; population_note: string; outcome_definition: string;
}
