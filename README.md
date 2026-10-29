# HealthTwin: AI-Powered Personal Health Risk Simulator

Keep your health history in one place, get diabetes and heart disease estimates from trained models, see why (SHAP), and explore "what if" changes.

> **Experimental model estimates, not diagnoses.** Built on small public datasets, not clinically validated. Not a medical device. In an emergency call your local number (112 in India).

## Honesty principles
- Every risk number comes from a trained, calibrated model. Nothing is hard-coded or invented.
- Three kinds of content look different: **Measured** (your data), **AI estimate** (model output), **Hypothetical** (simulator).
- The diabetes model needs a **2-hour glucose tolerance** value. A fasting or random glucose is never substituted.
- The AI explainer answers from stored fields; free-text model replies are used only with consent, and any reply containing a number not in the facts is discarded. Emergency questions never reach a model.
- Lab reports are processed in memory and never stored. Dates are never guessed. Imports are previewed before saving.
- Share links store only a hash, are revocable, and expired/revoked/unknown links look identical.

## Features
Dashboard (gauge, Why, Digital Twin) · risk details with cohort percentile · What-If Simulator · Goal Planner · scenario comparison · Trends and Time Machine · Model Reliability / Trust Meter · lab-report OCR and wearable CSV import · doctor report with share link · privacy (export, consent, delete) · dark mode · English and Hindi (shell, auth, safety notices, settings; other screens still English) · installable PWA (shell only, never caches API data) · Ctrl/⌘+K command palette · axe-clean in light and dark.

## Quick start
```bash
# backend (API docs at :8000/docs)
cd backend && pip install -r requirements.txt
alembic upgrade head && uvicorn app.main:create_app --factory --reload
# frontend (:5173)
cd frontend && npm ci && npm run dev
```
Tests: `cd backend && python -m pytest -q` · `cd ml && python -m pytest -q` · `cd frontend && npx tsc --noEmit && npx vitest run`.
OCR needs the `tesseract-ocr` system package.

## Architecture
`ml/` training, calibration, SHAP, inference, versioned artifacts and model cards → `backend/` FastAPI + SQLAlchemy + Alembic (JWT with rotating refresh tokens, argon2, rate limits, audit log without health values, append-only measurements) → `frontend/` React 18 + TypeScript + Tailwind v4. Design and API contract: `docs/PHASE1.md`.

## Deploy
```bash
cp deploy/.env.example deploy/.env   # set POSTGRES_PASSWORD and HT_SECRET_KEY (32+ chars)
docker compose --env-file deploy/.env up --build   # app on :8080
```
Put HTTPS in front (load balancer, Caddy or Traefik). nginx sets a strict CSP and security headers. **The Dockerfiles and compose stack are untested**: the author's environment had no Docker daemon. Production mode itself (`HT_ENV=prod`, migrations, `/healthz`) was run natively on SQLite.

## Known limitations
- **Heart model (v1.0.0)**: trained on the 303-row Cleveland file. It estimates whether artery narrowing is found at angiography, not future risk. Test ROC-AUC is 0.95 but the test set is only 61 rows; cross-validated AUC is 0.85, the more realistic figure. The What-If Simulator and Goal Planner work for both conditions; for heart only blood pressure and cholesterol can be changed.
- The diabetes model was trained on Pima women aged 21–81; results for others are a demonstration only.
- Not yet verified: Alembic on PostgreSQL, CI on GitHub, the Anthropic provider against the live API, the service worker and CSP in a real browser.
- Voice input is not built; Hindi is partial.

## Status
Phases 1–7 done. Phase 7 added dark mode, Hindi, PWA, command palette, accessibility fixes, CI frontend job and deployment files.
