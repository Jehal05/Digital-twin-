# HealthTwin backend (Phase 3)

FastAPI service: auth, health profile, measurements, predictions, What-If scenarios, Goal Planner, cohort percentile, dashboard, model evaluation, privacy export/delete. Every risk number comes from the trained models in `../ml`; there are no hard-coded scores.

## Run (development)
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:create_app --factory --reload      # http://localhost:8000/docs (docs are disabled when HT_ENV=prod)
python -m pytest -q                                 # 61 tests
```
Settings are `HT_*` environment variables (see `app/core/config.py`):

| Variable | Default | Notes |
|---|---|---|
| `HT_ENV` | `dev` | `prod` requires `HT_SECRET_KEY` and disables `/docs` |
| `HT_DATABASE_URL` | `sqlite:///./healthtwin.db` | production: `postgresql+psycopg://user:pass@host/db` |
| `HT_SECRET_KEY` | random per process in dev | **>= 32 chars, required in prod**; signs tokens and hashes IPs for audit |
| `HT_CORS_ORIGINS` | `["http://localhost:5173"]` | JSON list |
| `HT_ACCESS_TOKEN_MINUTES` / `HT_REFRESH_TOKEN_DAYS` | 15 / 7 | |

Production uses migrations, not auto-create: `HT_AUTO_CREATE_TABLES=false alembic upgrade head`.

## Endpoints (`/api/v1`)
Auth: `POST /auth/register|login|refresh|logout` · Profile: `GET/PUT /profile`, `GET/PUT /preferences`
Measurements: `POST|GET /measurements`, `GET /measurements/flagged`, `POST /measurements/{id}/resolve`
Predictions: `POST /predictions/diabetes|heart-disease`, `GET /predictions/history|{id}|{id}/trust`
Scenarios: `POST|GET /scenarios`, `GET|DELETE /scenarios/{id}`, `POST /scenarios/goal-plan`
Insights: `GET /cohort/percentile`, `GET /dashboard`, `GET /models/evaluation` · Privacy: `GET /privacy/export`, `DELETE /privacy/account`
Ops: `GET /healthz`. All errors use `{"error": {"code", "message", "fields"}}`.

## Behaviour worth knowing
- **Authorization:** every query filters by the token's user id; another user's record id returns 404, exactly like a missing one. Request bodies reject unknown fields, so an owner id cannot be spoofed.
- **Measurements are append-only.** No edit/delete routes. A flagged reading (sudden jump within 48 h) is confirmed, or corrected by adding a new row and hiding the wrong one.
- **No silent filling.** `use_latest` assembles inputs from the profile and recent measurements and reports the source of each value; anything missing is listed in a 422. Explicit `features` always win.
- **Content tags** on every response: `measured`, `ai_estimate`, `hypothetical`, `cohort_comparison`.
- **What-If / Goal Planner** only change inputs the model marks editable, rerun the real model, never modify the baseline, and are excluded from prediction history. The planner searches decreases within realistic caps (`app/services/goal_planner.py`) and says so when no feasible change exists.
- **Sessions:** short-lived access JWT plus rotating refresh tokens stored as hashes; reusing a rotated token revokes the whole family.
- **Heart-disease endpoints return 503 `model_unavailable` until `ml/data/raw/processed.cleveland.data` is added and the model is trained.**

## Known limitations (to address before real users)
- Login/register rate limiting is in memory (single process). Use a shared store behind several workers.
- Alembic migration is verified on SQLite (upgrade, no drift, downgrade) and its PostgreSQL SQL renders and parses, but it has **not been run against a live PostgreSQL server** yet.
- No email verification, password reset, or MFA. Registering an existing email returns 409, which reveals that the account exists.
- Uploads, OCR/CSV import, doctor-visit report, share links, AI explainer and streaks are later phases (tables exist, endpoints do not).
- Account deletion removes database rows; file-storage cleanup arrives with uploads.
- Not a security audit. Treat as a well-tested prototype.
