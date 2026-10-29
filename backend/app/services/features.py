"""Builds model inputs from a user's stored profile and measurements, and says where each value came from.

Nothing is guessed or filled in: a feature that cannot be derived is reported as missing and the caller must supply it.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.tables import HealthMeasurement, HealthProfile, User

# model feature -> measurement type it can be read from
MEASURED = {
    "diabetes": {"glucose": "glucose_2h_mgdl", "blood_pressure": "bp_diastolic", "bmi": "bmi"},
    "heart_disease": {"trestbps": "bp_systolic", "chol": "cholesterol_mgdl", "thalach": "heart_rate_max"},
}


def age_years(dob: date, today: date | None = None) -> int:
    today = today or date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def latest(db: Session, user_id, measurement_type: str) -> HealthMeasurement | None:
    return db.scalar(
        select(HealthMeasurement)
        .where(HealthMeasurement.user_id == user_id, HealthMeasurement.measurement_type == measurement_type,
               HealthMeasurement.validation_status != "rejected")
        .order_by(HealthMeasurement.recorded_at.desc(), HealthMeasurement.created_at.desc()).limit(1))


def derive_bmi(db: Session, user_id, profile: HealthProfile | None) -> tuple[float, str] | None:
    m = latest(db, user_id, "bmi")
    if m:
        return m.value, f"measured {m.recorded_at.date()}"
    w = latest(db, user_id, "weight_kg")
    h_m = latest(db, user_id, "height_cm")
    height = h_m.value if h_m else (profile.height_cm if profile else None)
    if w and height:
        return round(w.value / (height / 100) ** 2, 1), f"computed from weight ({w.recorded_at.date()}) and height"
    return None


def assemble_inputs(db: Session, user: User, condition: str, explicit: dict, use_latest: bool,
                    feature_names: list[str]) -> tuple[dict, dict, dict]:
    """Returns (inputs, sources, missing). Explicit values always win over derived ones."""
    inputs, sources = {}, {}
    if use_latest:
        profile = db.get(HealthProfile, user.id)
        if "age" in feature_names and profile and profile.date_of_birth:
            inputs["age"], sources["age"] = age_years(profile.date_of_birth), "profile date of birth"
        if "sex" in feature_names and profile and profile.sex in ("male", "female"):
            inputs["sex"], sources["sex"] = 1 if profile.sex == "male" else 0, "profile"
        for feature, mtype in MEASURED.get(condition, {}).items():
            if feature == "bmi":
                got = derive_bmi(db, user.id, profile)
                if got:
                    inputs["bmi"], sources["bmi"] = got
                continue
            if feature in feature_names:
                m = latest(db, user.id, mtype)
                if m:
                    inputs[feature], sources[feature] = m.value, f"measured {m.recorded_at.date()}"
    for k, v in (explicit or {}).items():
        inputs[k], sources[k] = v, "provided in request"
    hints = {"glucose": "needs a 2-hour glucose tolerance test value; a fasting or random glucose reading is a different measurement and is not used"}
    missing = {f: hints.get(f, "not available: add a measurement or provide it in 'features'") for f in feature_names if f not in inputs}
    return inputs, sources, missing
