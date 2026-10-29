# HealthTwin: AI-Powered Personal Health Risk Simulator

A web app that keeps a person's health history, estimates diabetes and heart disease risk with trained ML models, explains why (SHAP), and lets users explore hypothetical changes in a What-If Simulator.

> **Experimental model estimates, not diagnoses.** Built on small public datasets that have not been clinically validated. Not a medical device.

## Status
| Phase | Scope | State |
|---|---|---|
| 1 | Structure, database schema, API contract | Done (`docs/PHASE1.md`, `backend/schema.sql`) |
| 2 | ML training, evaluation, calibration, SHAP, Trust Meter inputs, model cards | Diabetes done; heart model needs `ml/data/raw/processed.cleveland.data` (see `ml/README.md`) |
| 3 | FastAPI backend | Not started |
| 4-7 | Frontend, simulator, ingestion, privacy, deployment | Not started |

## Layout
`frontend/` React + TypeScript (planned) · `backend/` FastAPI (planned) · `ml/` training, evaluation, inference (working) · `docs/` design and API contract · `e2e/` · `scripts/`

## Try the ML part
```bash
cd ml && pip install -r requirements.txt
python -m src.train --condition diabetes
python -m pytest -q
```
See `ml/README.md` and `ml/artifacts/diabetes/1.0.0/MODEL_CARD.md`.
