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

export interface CsvRow { line: number; status: "ok" | "error"; measurement_type: string; value?: number; unit?: string; recorded_at?: string; message?: string; note?: string }
export interface CsvPreview { rows: CsvRow[]; summary: { ok: number; errors: number }; layout: "long" | "wide" }
export interface LabCandidate { measurement_type: string; value: number; unit: string; unit_found_in_text: boolean; snippet: string; confidence: "high" | "medium" | "low" }
export interface LabPreview { method: "ocr" | "pdf_text"; ocr_confidence: number | null; file_stored: false; candidates: LabCandidate[]; detected_dates: string[]; ambiguous_dates_found: boolean; note: string }
export interface CommitResult { created: number; skipped_duplicates: number; flagged: number; errors: { index: number; message: string }[] }
export interface ReportMeasurement { measurement_type: string; unit: string; count: number; first: number; latest: number; min: number; max: number; latest_at: string; sources: string[] }
export interface ReportEstimate { condition: Condition; score: number; risk_band: RiskBand; created_at: string; inputs: Record<string, number>;
  model_range: { low?: number; high?: number }; top_drivers: { feature?: string; label: string; effect: number; direction: "raises" | "lowers" }[]; limitations: string[] }
export interface Report { generated_at: string; disclaimer: string; sections: string[]; shared?: boolean; expires_at?: string;
  profile?: { age: number | null; sex: string | null; height_cm: number | null }; measurements?: ReportMeasurement[]; measurement_window_days?: number;
  estimates?: ReportEstimate[]; scenario_count?: number }
export interface ShareLinkInfo { id: string; include: string[]; expires_at: string; created_at: string; revoked: boolean; active: boolean; token?: string; path?: string }
export interface ExplainReply { answer: string; source: "template" | "llm" | "safety"; refused: boolean; topic: string | null; disclaimer: string; cited_prediction_id: string }
export interface Consents { current: Record<string, { granted: boolean; recorded_at: string }>; history_count: number; ai_explainer_available: boolean }
