-- HealthTwin Phase 1 schema (PostgreSQL), extended for goal planner, trust meter, reports, explainer. Alembic migrations will be generated from the SQLAlchemy models.
-- Principles: measurements are append-only, ownership on every row, raw uploads kept apart from validated data.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    display_name    TEXT,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','deleted')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE health_profiles (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    date_of_birth   DATE,
    sex             TEXT CHECK (sex IN ('female','male','other')),
    height_cm       NUMERIC(5,1) CHECK (height_cm BETWEEN 50 AND 250),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_type    TEXT NOT NULL,          -- e.g. 'data_processing', 'ai_explainer'
    granted         BOOLEAN NOT NULL,
    policy_version  TEXT NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE uploaded_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('lab_report','wearable_csv')),
    original_name   TEXT NOT NULL,
    storage_key     TEXT NOT NULL,          -- path/key in file storage, never user-controlled
    size_bytes      BIGINT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'uploaded'
                    CHECK (status IN ('uploaded','extracted','awaiting_review','confirmed','rejected','failed')),
    extracted_json  JSONB,                  -- OCR/CSV output awaiting user confirmation
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only: a new reading is a new row. Never UPDATE a value; correct by adding a new row.
CREATE TABLE health_measurements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    measurement_type TEXT NOT NULL,         -- see measurement catalogue in PHASE1.md
    value           NUMERIC(10,3) NOT NULL,
    unit            TEXT NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL,   -- when the reading was taken
    source          TEXT NOT NULL CHECK (source IN ('manual','lab_report_ocr','wearable_csv','demo')),
    source_file_id  UUID REFERENCES uploaded_files(id) ON DELETE SET NULL,
    validation_status TEXT NOT NULL DEFAULT 'valid' CHECK (validation_status IN ('valid','flagged','rejected')),
    flag_reason     TEXT,                   -- anomaly detection: why it was flagged (e.g. 'jump_vs_previous'); user confirms or corrects
    ocr_confidence  NUMERIC(4,3),           -- lab-report OCR only; low values are highlighted on the review screen
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_measurements_user_type_time ON health_measurements (user_id, measurement_type, recorded_at DESC);

CREATE TABLE model_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condition       TEXT NOT NULL CHECK (condition IN ('diabetes','heart_disease')),
    version         TEXT NOT NULL,
    algorithm       TEXT NOT NULL,          -- 'logistic_regression' | 'random_forest'
    dataset_ref     TEXT NOT NULL,          -- dataset name + source + checksum
    feature_schema  JSONB NOT NULL,         -- ordered features, types, allowed ranges
    metrics         JSONB NOT NULL,         -- accuracy, sensitivity, specificity, roc_auc, confusion matrix, calibration, class balance
    cohort_stats    JSONB,                  -- per-feature percentiles + min/max of the TRAINING data (cohort percentile, out-of-distribution check)
    artifact_path   TEXT NOT NULL,
    intended_use    TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (condition, version)
);

CREATE TABLE predictions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_version_id UUID NOT NULL REFERENCES model_versions(id),
    input_snapshot  JSONB NOT NULL,         -- exact features sent to the model
    score           NUMERIC(6,5) NOT NULL CHECK (score BETWEEN 0 AND 1),  -- model-estimated probability
    risk_band       TEXT NOT NULL CHECK (risk_band IN ('low','moderate','high')),
    explanation     JSONB,                  -- SHAP values for this input
    trust           JSONB,                  -- Trust Meter: model agreement (LR vs RF), uncertainty range, out_of_distribution features
    limitations     JSONB,                  -- limitation strings shown with this estimate, frozen at prediction time
    is_hypothetical BOOLEAN NOT NULL DEFAULT false,  -- true for what-if / goal-plan runs; excluded from prediction history
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_predictions_user_time ON predictions (user_id, created_at DESC);

CREATE TABLE simulation_scenarios (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'what_if' CHECK (kind IN ('what_if','goal_plan')),
    target_score    NUMERIC(6,5),           -- goal_plan only: the score the user asked to get below
    condition       TEXT NOT NULL CHECK (condition IN ('diabetes','heart_disease')),
    baseline_prediction_id UUID NOT NULL REFERENCES predictions(id),
    scenario_prediction_id UUID NOT NULL REFERENCES predictions(id),
    changed_inputs  JSONB NOT NULL,         -- only the fields that differ from baseline
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type      TEXT NOT NULL,          -- 'login','export','delete_account','upload','prediction', ...
    ip_hash         TEXT,                   -- hashed, not raw
    detail          JSONB,                  -- never contains passwords or health values
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Added for the extended feature set
-- ---------------------------------------------------------------------------

CREATE TABLE user_preferences (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    locale          TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','hi')),
    theme           TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark','system')),
    reduced_motion  BOOLEAN NOT NULL DEFAULT false,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Doctor Visit Report share links: read-only, expiring, revocable. Only a hash of the token is stored.
CREATE TABLE share_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    scope           JSONB NOT NULL,         -- which sections are shared (trends, predictions, scenarios)
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI Health Explainer history. cited_record_ids lets the UI show exactly which records an answer used.
CREATE TABLE explainer_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content         TEXT NOT NULL,
    cited_record_ids JSONB,
    refused         BOOLEAN NOT NULL DEFAULT false,   -- true when the safety rules blocked the question
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_explainer_user_time ON explainer_messages (user_id, created_at DESC);

-- Rotating refresh tokens. Only a hash is stored. Re-use of a revoked token revokes the whole family.
CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id       UUID NOT NULL,
    token_hash      TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_family ON refresh_tokens (family_id);
