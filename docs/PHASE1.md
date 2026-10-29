# HealthTwin — Phase 1: Structure, Schema, API Contract

## 0. Assumptions (tell me if any is wrong)
- Team 2–4, 8 weeks, final-year project (the brackets in the prompt were blank).
- Models: **Pima Indians Diabetes** → diabetes; **UCI Heart Disease** → heart disease. **Framingham is reference/EDA only** (different population, labels and features; no blind merging).
- Scores are **experimental model-estimated probabilities**, not clinical risk. Every risk number shows that label.
- No genetics/methylation/epigenetic cards (the reference screenshot has them; our datasets don't). Replaced with data we actually have: measurements, SHAP drivers, trends, model evaluation.
- "Health age" is **parked**. Neither dataset supports an honest biological-age calculation. Decision revisited in Phase 5 only if a defensible method exists.
- Postgres in Docker Compose; SQLite allowed for local dev.
- Synthetic demo data only.

## 0b. Scope tiers (from the final prompt)
- **Must ship:** auth, measurements, two models, simulator, trends (B), SHAP (A), reliability page (C), scenario comparison (D), privacy (F), Digital Twin, Trust Meter.
- **Next:** lab OCR (E), wearable CSV (G), Goal Planner, Time Machine, Doctor Report.
- **If time permits:** AI Explainer (H), cohort percentile, anomaly detection, polish (voice, Hindi, PWA, command palette).
- **Defer first when behind:** voice, Hindi, PWA offline, share links.

## 0c. Design system rules that affect the data contract
Three content kinds are tagged in every API response so the UI can style them consistently:
| `content_kind` | Meaning | UI treatment |
|---|---|---|
| `measured` | A recorded reading (has source + timestamp) | solid, neutral, "Measured" tag |
| `ai_estimate` | Model output from real inputs | accent colour, "AI estimate" tag |
| `hypothetical` | Scenario, goal plan or trend projection | dashed/hatched, "Hypothetical" tag |

The 5-step progress rail is: **My Health Data → AI Analysis → Explain Why → Simulate Changes → Track Over Time**.
Design tokens (colour, type scale, spacing, radius 24px, elevation, motion) live in `frontend/src/styles/tokens.ts` and are built in Phase 4.

Screens (14): login/registration, health profile, main dashboard (Digital Twin), health trends, diabetes risk, heart disease risk, explainable AI, What-If Simulator with Goal Planner, scenario comparison, lab report OCR, wearable data, AI Health Explainer, model evaluation, privacy/settings.

## 1. Folder structure
```
healthtwin/
├── frontend/            React + TS + Vite + Tailwind + Recharts
│   └── src/
│       ├── components/  layout/ dashboard/ simulator/ twin/ charts/ ui/
│       ├── pages/       Dashboard, Simulator, Scenarios, Reliability, Uploads, Privacy
│       ├── api/  hooks/  styles/  types/
├── backend/             FastAPI
│   ├── app/
│   │   ├── api/v1/      routers
│   │   ├── core/        config, security, db session
│   │   ├── models/      SQLAlchemy models
│   │   ├── schemas/     Pydantic request/response
│   │   ├── services/    prediction, simulator, scenarios, privacy
│   │   ├── ingestion/   csv + OCR parsers, unit normalisation
│   │   └── explainer/   grounded AI explainer + safety rules
│   ├── alembic/versions/
│   ├── tests/
│   └── schema.sql       reference schema
├── ml/
│   ├── data/raw/  notebooks/  src/  artifacts/  reports/
├── e2e/                 Playwright
├── scripts/             seed demo data, train, export
├── docs/                this file, model cards
└── .github/workflows/   CI
```

## 2. Model input schemas (the contract the simulator obeys)

### Diabetes (Pima) — all 8 features
| Feature | Unit | Allowed range (validation) | Simulator-editable? |
|---|---|---|---|
| pregnancies | count | 0–20 | no (history) |
| glucose | mg/dL | 40–400 | yes |
| blood_pressure (diastolic) | mmHg | 30–130 | yes |
| skin_thickness | mm | 0–100 | no |
| insulin | µU/mL | 0–900 | yes |
| bmi | kg/m² | 12–70 | yes |
| diabetes_pedigree | score | 0.05–2.5 | no (family history) |
| age | years | 18–100 | no |

Note: in Pima, zeros in glucose/BP/skin/insulin/BMI mean "missing". Training treats them as missing and imputes using training-set statistics only. At inference, missing required values are **rejected**, never silently filled.

### Heart disease (UCI Cleveland) — 13 features
age, sex, cp (chest-pain type), trestbps (resting BP), chol, fbs, restecg, thalach (max HR), exang, oldpeak, slope, ca, thal.
Simulator-editable (continuous, plausibly modifiable): trestbps, chol, thalach. Everything else is read-only context.

### Consequence for the simulator
Lifestyle sliders (smoking, exercise, sleep) are **not offered** because neither model was trained on them. The simulator changes only inputs the model accepts.

## 3. Measurement catalogue (`measurement_type` values)
`weight_kg, height_cm, bmi, glucose_mgdl, bp_systolic, bp_diastolic, cholesterol_mgdl, insulin_uuml, heart_rate_max, resting_hr, steps, sleep_hours` — each with a canonical unit; imports are normalised to it.

## 4. API contract (prefix `/api/v1`, JSON, JWT bearer unless noted)

Errors use one shape: `{"error": {"code": "string", "message": "string", "fields": {"name": "reason"}}}`.
Common: `401` unauthenticated, `403` not your record (returned as `404` for other users' ids to avoid leaking existence), `422` validation, `429` rate limited.

| Method + path | Purpose | Request (key fields) | Success response |
|---|---|---|---|
| POST /auth/register | Create account + consent | email, password (≥10 chars), consents[] | 201 user, tokens |
| POST /auth/login | Log in | email, password | 200 access + refresh token |
| POST /auth/refresh | Rotate token | refresh_token | 200 tokens |
| GET /profile | Current profile | — | profile, derived age/BMI |
| PUT /profile | Update | date_of_birth, sex, height_cm | profile |
| POST /measurements | Add reading | type, value, unit, recorded_at | 201 measurement (validation_status) |
| GET /measurements | History | type?, from?, to?, limit, cursor | list + next_cursor |
| POST /predictions/diabetes | Run model | features (or `use_latest: true`) | prediction (below) |
| POST /predictions/heart-disease | Run model | same | prediction |
| POST /scenarios | Run + save scenario | name, condition, baseline_prediction_id, changed_inputs | scenario with both predictions + delta |
| GET /scenarios | List | condition? | list |
| GET /scenarios/{id} | One | — | scenario |
| DELETE /scenarios/{id} | Remove | — | 204 |
| POST /uploads | Upload lab report or wearable CSV (multipart) | file, kind | 202 upload id, status |
| GET /uploads/{id} | Status + extracted values | — | status, extracted[] |
| POST /uploads/{id}/confirm | Save user-reviewed values | corrected values[] | 201 created measurements |
| POST /explanations | Grounded AI explainer | question | answer, cited_records[], disclaimer |
| GET /dashboard | Summary | — | latest measurements, latest predictions, trend series, scenario count |
| GET /models/evaluation | Metrics and model cards | condition? | versions, metrics, curves |
| POST /scenarios/goal-plan | Goal Planner: search realistic editable inputs to get below a target | condition, baseline_prediction_id, target_score, locked_inputs[] | plan (changed_inputs, resulting prediction) or `feasible: false` with the closest result |
| GET /predictions/{id}/trust | Trust Meter details | — | model agreement, uncertainty range, out_of_distribution[] |
| GET /predictions/history | Time Machine: predictions over time | condition, from?, to? | series of predictions (`ai_estimate`) |
| GET /trends/projection | Projection of the user's OWN trend | measurement_type, horizon_days | series tagged `hypothetical`, with method note |
| GET /cohort/percentile | Percentile within training cohort | measurement_type, value, condition | percentile, cohort description |
| GET /measurements/flagged | Anomalies awaiting confirmation | — | list with flag_reason |
| POST /measurements/{id}/resolve | Confirm or correct a flagged reading | action: confirm / correct(value) | measurement (a correction creates a new row) |
| GET /streaks | Gentle logging streaks | — | current/longest streak |
| POST /reports/doctor-visit | Generate PDF | sections[], date_range | 202 report id; GET returns PDF |
| POST /share-links | Create read-only link | scope, expires_in_days | 201 link (token shown once) |
| DELETE /share-links/{id} | Revoke | — | 204 |
| GET /shared/{token} | Public read-only report view (no auth, rate-limited) | — | report data or 404 if expired/revoked |
| GET /explanations/history | Explainer chat history | limit | messages with cited_record_ids |
| GET/PUT /preferences | Locale, theme, reduced motion | locale, theme | preferences |
| GET /privacy/export | Download my data | — | JSON/zip |
| DELETE /privacy/account | Delete account + files | password | 202 |

### Prediction response (used by dashboard, simulator, twin panel)
```json
{
  "id": "uuid",
  "condition": "diabetes",
  "score": 0.31,
  "risk_band": "moderate",
  "model": {"version": "diabetes-1.0.0", "algorithm": "random_forest"},
  "input_snapshot": {"glucose": 128, "bmi": 31.2},
  "explanation": {"method": "shap", "output": "probability", "top_drivers": [
      {"feature": "glucose", "value": 128, "effect": 0.09, "direction": "raises"}
  ]},
  "limitations": ["Experimental model estimate, not a diagnosis.", "Trained on a specific study population."],
  "created_at": "iso8601"
}
```
(Numbers above are shape examples only; real values always come from the trained model.)

### Trust Meter block (added to every prediction response)
```json
"trust": {
  "model_agreement": {"logistic_regression": 0.29, "random_forest": 0.33, "difference_pp": 4, "level": "high"},
  "uncertainty_range": {"low": 0.24, "high": 0.38, "method": "bootstrap_ensemble"},
  "out_of_distribution": [{"feature": "bmi", "value": 68, "training_range": [18.2, 67.1]}]
}
```
Shape example only. Values are computed at inference from the saved models and `model_versions.cohort_stats`.

### Goal Planner rules
Search only EDITABLE inputs, inside the validated ranges, and never beyond a "realistic change" cap per feature (defined in the model card). The response says plainly when no feasible change reaches the target. Always tagged `hypothetical`.

### AI Explainer safety rules (enforced server-side, not only in the prompt)
Context is limited to the caller's own records plus approved reference text. Outputs that diagnose, invent a measurement or promise an outcome are blocked and logged as `refused`. Retrieved text and uploaded-file text are treated as data, never as instructions.

### Scenario response adds
`baseline` and `scenario` predictions, `changed_inputs`, `delta` = scenario.score − baseline.score (percentage points), plus a note that this is a change in a model estimate, not a proven health outcome.

## 5. Cross-cutting rules
- Every query filters by `user_id` from the token, never from the request body.
- Measurements are append-only; corrections are new rows.
- Uploads: size limit, extension + content-type checks, stored under generated keys, OCR output sits in `awaiting_review` until the user confirms.
- Logs never contain passwords, tokens or health values.
- Rate limiting on auth, uploads and explanations.

## 6. Done criteria for Phase 1
- [x] Folder tree created
- [x] `backend/schema.sql` (12 tables: original 9 + user_preferences, share_links, explainer_messages)
- [x] Model input schemas and API contract (this file)
- [ ] Your sign-off on assumptions in section 0, then Phase 2 (ML training + evaluation)

## 7. Revisions made in Phase 2 (these supersede section 2 where they differ)
- **Diabetes model uses 5 inputs:** pregnancies, glucose, diastolic blood pressure, BMI, age. Skin thickness, insulin and pedigree were dropped (heavily missing, or not obtainable by a user). Editable in What-If: glucose, blood pressure, BMI. Pima glucose is a 2-hour oral-glucose-tolerance value.
- **Heart model uses 10 inputs:** age, sex, cp, trestbps, chol, fbs, restecg, thalach, exang, oldpeak (no slope, ca, thal). Editable in What-If: trestbps and chol only.
- Source of truth for ranges, units, editable flags and categories is `ml/src/config.py`; the backend and UI should read the exported `feature_schema.json`, not copy values from this document.
- Predictions carry the dataset's label definition (diabetes diagnosis in Pima; angiographic disease in Cleveland), not "future risk".
