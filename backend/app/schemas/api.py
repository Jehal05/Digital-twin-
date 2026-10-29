"""Request schemas (responses are plain dicts built by the routers so content_kind tags stay explicit)."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConsentIn(Strict):
    type: Literal["data_processing", "ai_explainer", "share_with_clinician"]
    granted: bool


class RegisterIn(Strict):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    display_name: str | None = Field(default=None, max_length=100)
    consents: list[ConsentIn]

    @field_validator("password")
    @classmethod
    def not_trivial(cls, v: str) -> str:
        if v.isdigit() or v.isalpha() or len(set(v)) < 5:
            raise ValueError("use a mix of letters, numbers or symbols")
        return v


class LoginIn(Strict):
    email: EmailStr
    password: str = Field(max_length=128)


class RefreshIn(Strict):
    refresh_token: str = Field(max_length=200)


class ProfileIn(Strict):
    display_name: str | None = Field(default=None, max_length=100)
    date_of_birth: date | None = None
    sex: Literal["female", "male", "other"] | None = None
    height_cm: float | None = Field(default=None, ge=50, le=250)

    @field_validator("date_of_birth")
    @classmethod
    def sane_dob(cls, v):
        if v is not None and not (date(1900, 1, 1) <= v <= date.today()):
            raise ValueError("must be between 1900-01-01 and today")
        return v


class MeasurementIn(Strict):
    measurement_type: str = Field(max_length=32)
    value: float
    unit: str = Field(max_length=16)
    recorded_at: datetime


class ResolveIn(Strict):
    action: Literal["confirm", "correct"]
    value: float | None = None
    unit: str | None = Field(default=None, max_length=16)


class PredictIn(Strict):
    features: dict[str, float] = Field(default_factory=dict)
    use_latest: bool = False


class ScenarioIn(Strict):
    name: str = Field(min_length=1, max_length=80)
    condition: Literal["diabetes", "heart_disease"]
    baseline_prediction_id: uuid.UUID
    changed_inputs: dict[str, float] = Field(min_length=1)


class GoalPlanIn(Strict):
    condition: Literal["diabetes", "heart_disease"]
    baseline_prediction_id: uuid.UUID
    target_score: float = Field(gt=0.01, lt=0.99, description="probability the estimate should fall below, e.g. 0.20")
    locked_inputs: list[str] = Field(default_factory=list, max_length=10)


class PreferencesIn(Strict):
    locale: Literal["en", "hi"] | None = None
    theme: Literal["light", "dark", "system"] | None = None
    reduced_motion: bool | None = None


class DeleteAccountIn(Strict):
    password: str = Field(max_length=128)


class ImportRow(Strict):
    measurement_type: str = Field(max_length=32)
    value: float
    unit: str = Field(max_length=16)
    recorded_at: datetime
    ocr_confidence: float | None = Field(default=None, ge=0, le=1)


class CommitIn(Strict):
    source: Literal["csv", "ocr"]
    rows: list[ImportRow] = Field(min_length=1, max_length=500)


class ExplainIn(Strict):
    prediction_id: uuid.UUID
    topic: Literal["summary", "why", "uncertainty", "what_can_change", "about_model"] | None = None
    question: str | None = Field(default=None, max_length=300)


class ShareIn(Strict):
    expires_in_days: int = Field(default=7, ge=1, le=30)
    include: list[Literal["profile", "measurements", "estimates"]] = Field(default_factory=lambda: ["measurements", "estimates"], min_length=1)


class ConsentIn(Strict):
    consent_type: Literal["ai_explainer"]
    granted: bool
