# HealthTwin: AI-Powered Personal Health Risk Simulator

A web app that keeps a person's health history, estimates diabetes and heart disease risk with trained ML models, explains why (SHAP), and lets users explore hypothetical changes in a What-If Simulator.

> **Experimental model estimates, not diagnoses.** Built on small public datasets that have not been clinically validated. Not a medical device.

## Status
| Phase | Scope | State |
|---|---|---|
| 1 | Structure, database schema, API contract | Done (`docs/PHASE1.md`, `backend/schema.sql`) |
| 2 | ML training, evaluation, calibration, SHAP, Trust Meter inputs, model cards | Diabetes done; heart model needs `ml/data/raw/processed.cleveland.data` (see `ml/README.md`) |
| 3 | FastAPI backend (auth, measurements, predictions, scenarios, Goal Planner, privacy) | Done: 61 tests, see `backend/README.md`. Heart endpoints return 503 until the heart model is trained. |
| 4 | Design system, sign-in, profile and readings, dashboard (gauge, Why, Digital Twin, disease cards) | Done (23 frontend tests) |
| 5 | Risk details (SHAP walk, cohort percentile), What-If Simulator, Goal Planner, scenario comparison, Trends + Time Machine, Model Reliability | Done (27 frontend tests) |
| 6-7 | Lab OCR, wearable CSV, AI explainer, doctor report, privacy UI, polish, deployment | Not started |

## Layout
`frontend/` React + TypeScript + Tailwind (dashboard working; run `npm run dev`, API on :8000) · `backend/` FastAPI (working) · `ml/` training, evaluation, inference (working) · `docs/` design and API contract · `e2e/` · `scripts/`

## Try it
```bash
cd backend && pip install -r requirements.txt
uvicorn app.main:create_app --factory --reload   # API docs at /docs
python -m pytest -q
```

## ML part
```bash
cd ml && pip install -r requirements.txt
python -m src.train --condition diabetes
python -m pytest -q
```
See `ml/README.md` and `ml/artifacts/diabetes/1.0.0/MODEL_CARD.md`.
