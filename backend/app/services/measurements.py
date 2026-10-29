"""Measurement catalogue: canonical units, unit conversion, plausibility limits and anomaly rules."""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class Spec:
    canonical_unit: str
    min: float
    max: float
    to_canonical: dict          # lowercase unit name -> multiplier
    jump_ratio: float | None    # flag a reading that differs from the previous one (within 48 h) by more than this fraction


CATALOG: dict[str, Spec] = {
    "weight_kg": Spec("kg", 20, 400, {"kg": 1, "lb": 0.45359237, "lbs": 0.45359237}, 0.10),
    "height_cm": Spec("cm", 50, 250, {"cm": 1, "m": 100, "in": 2.54}, 0.05),
    "bmi": Spec("kg/m2", 10, 80, {"kg/m2": 1}, 0.10),
    "glucose_mgdl": Spec("mg/dL", 30, 600, {"mg/dl": 1, "mmol/l": 18.016}, 0.60),
    "glucose_2h_mgdl": Spec("mg/dL", 30, 600, {"mg/dl": 1, "mmol/l": 18.016}, 0.60),  # 2-hour OGTT value: the one the diabetes model uses
    "bp_systolic": Spec("mmHg", 50, 260, {"mmhg": 1}, 0.40),
    "bp_diastolic": Spec("mmHg", 30, 160, {"mmhg": 1}, 0.40),
    "cholesterol_mgdl": Spec("mg/dL", 50, 700, {"mg/dl": 1, "mmol/l": 38.67}, 0.50),
    "heart_rate_max": Spec("bpm", 60, 230, {"bpm": 1}, 0.50),
    "resting_hr": Spec("bpm", 30, 220, {"bpm": 1}, 0.50),
    "steps": Spec("count", 0, 100_000, {"count": 1, "steps": 1}, None),
    "sleep_hours": Spec("h", 0, 24, {"h": 1, "hours": 1}, None),
}

FLAG_WINDOW = timedelta(hours=48)
MAX_FUTURE = timedelta(minutes=5)


class MeasurementError(ValueError):
    def __init__(self, field: str, message: str):
        self.field, self.message = field, message
        super().__init__(message)


def to_canonical(measurement_type: str, value: float, unit: str) -> float:
    spec = CATALOG.get(measurement_type)
    if spec is None:
        raise MeasurementError("measurement_type", f"unknown type; allowed: {sorted(CATALOG)}")
    factor = spec.to_canonical.get(unit.strip().lower())
    if factor is None:
        raise MeasurementError("unit", f"unsupported unit for {measurement_type}; use one of {sorted(spec.to_canonical)}")
    if not math.isfinite(value):
        raise MeasurementError("value", "must be a finite number")
    canonical = round(value * factor, 3)
    if not (spec.min <= canonical <= spec.max):
        raise MeasurementError("value", f"{canonical} {spec.canonical_unit} is outside the plausible range "
                                        f"{spec.min}-{spec.max} {spec.canonical_unit}")
    return canonical


def check_time(recorded_at: datetime, now: datetime) -> None:
    if recorded_at.tzinfo is None:
        raise MeasurementError("recorded_at", "must include a timezone, e.g. 2026-10-29T08:30:00+05:30")
    if recorded_at > now + MAX_FUTURE:
        raise MeasurementError("recorded_at", "cannot be in the future")


def anomaly_reason(measurement_type: str, value: float, recorded_at: datetime,
                   previous: tuple[float, datetime] | None) -> str | None:
    spec = CATALOG[measurement_type]
    if spec.jump_ratio is None or previous is None:
        return None
    prev_value, prev_time = previous
    if abs(recorded_at - prev_time) > FLAG_WINDOW or prev_value == 0:
        return None
    change = abs(value - prev_value) / abs(prev_value)
    if change > spec.jump_ratio:
        return f"jump_vs_previous: {change:.0%} change from {prev_value:g} within 48 h"
    return None
