"""Cohort percentile, dashboard summary and model evaluation (read-only views)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.v1.measurements import out as measurement_out
from app.api.v1.profile import profile_out
from app.core.db import get_db
from app.core.errors import ApiError
from app.core.security import current_user
from app.models.tables import HealthMeasurement, Prediction, SimulationScenario, User
from app.services.ml import CONDITIONS
from app.services.predictions import condition_of, prediction_out

router = APIRouter(tags=["insights"])


@router.get("/cohort/percentile")
def percentile(request: Request, condition: str = Query(pattern="^(diabetes|heart_disease)$"), feature: str = Query(max_length=32),
               value: float = Query(), user: User = Depends(current_user)):
    reg = request.app.state.registry
    model = reg.get(condition)
    stats = model.b["cohort_stats"].get(feature)
    if stats is None or "percentile_grid" not in stats:
        raise ApiError(422, "validation_error", "Percentiles are only available for numeric model inputs.",
                       {"feature": f"choose one of {[f for f, s in model.b['cohort_stats'].items() if 'percentile_grid' in s]}"})
    grid = np.array(stats["percentile_grid"])
    pct = float(np.interp(value, grid, np.arange(101)))
    spec = model.schema[feature]
    return {
        "content_kind": "cohort_comparison", "condition": condition, "feature": feature, "label": spec["label"],
        "unit": spec["unit"], "value": value, "percentile": round(pct, 1),
        "outside_cohort_range": bool(value < stats["min"] or value > stats["max"]),
        "cohort": model.b["schema"]["population_note"],
        "note": "Position within this study's training cohort only. It is not a statement about the general population.",
    }


@router.get("/dashboard")
def dashboard(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    reg = request.app.state.registry
    visible = HealthMeasurement.validation_status != "rejected"
    latest_ts = (select(HealthMeasurement.measurement_type, func.max(HealthMeasurement.recorded_at).label("ts"))
                 .where(HealthMeasurement.user_id == user.id, visible).group_by(HealthMeasurement.measurement_type).subquery())
    latest = db.scalars(select(HealthMeasurement).join(
        latest_ts, (HealthMeasurement.measurement_type == latest_ts.c.measurement_type) & (HealthMeasurement.recorded_at == latest_ts.c.ts))
        .where(HealthMeasurement.user_id == user.id, visible)).all()
    since = datetime.now(timezone.utc) - timedelta(days=90)
    trend: dict[str, list] = {}
    for m in db.scalars(select(HealthMeasurement).where(HealthMeasurement.user_id == user.id, visible,
                                                        HealthMeasurement.recorded_at >= since).order_by(HealthMeasurement.recorded_at)):
        trend.setdefault(m.measurement_type, []).append({"recorded_at": measurement_out(m)["recorded_at"], "value": m.value,
                                                         "unit": m.unit, "validation_status": m.validation_status})
    preds = {}
    for c in CONDITIONS:
        row = None
        for r in db.scalars(select(Prediction).where(Prediction.user_id == user.id, Prediction.is_hypothetical.is_(False))
                            .order_by(Prediction.created_at.desc())):
            if condition_of(db, r) == c:
                row = r
                break
        preds[c] = prediction_out(row, c, reg, db) if row else None
    return {
        "profile": profile_out(db, user),
        "latest_measurements": {m.measurement_type: measurement_out(m) for m in latest},
        "trend_series": trend,
        "latest_predictions": preds,
        "scenario_count": db.scalar(select(func.count()).select_from(SimulationScenario).where(SimulationScenario.user_id == user.id)),
        "flagged_count": db.scalar(select(func.count()).select_from(HealthMeasurement).where(
            HealthMeasurement.user_id == user.id, HealthMeasurement.validation_status == "flagged")),
        "models_available": sorted(reg.models),
    }


@router.get("/models/evaluation")
def evaluation(request: Request, condition: str | None = Query(None, pattern="^(diabetes|heart_disease)$"),
               user: User = Depends(current_user)):
    reg = request.app.state.registry
    conditions = [condition] if condition else sorted(reg.models)
    items = []
    for c in conditions:
        m = reg.get(c)
        items.append({"condition": c, "version": m.version, "primary_algorithm": m.primary, "metrics": reg.metrics(c),
                      "model_card_markdown": reg.model_card(c), "intended_use": reg.manifest(c)["intended_use"],
                      "population_note": m.b["schema"]["population_note"], "outcome_definition": m.b["schema"]["outcome_definition"]})
    return {"items": items, "unavailable": [c for c in CONDITIONS if c not in reg.models]}
