from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ApiError
from app.core.security import audit, current_user
from app.models.tables import Prediction, User
from app.schemas.api import PredictIn
from app.services.features import assemble_inputs
from app.services.predictions import condition_of, prediction_out, run_and_store

router = APIRouter(prefix="/predictions", tags=["predictions"])


def _predict(condition: str, body: PredictIn, request: Request, user: User, db: Session) -> dict:
    registry = request.app.state.registry
    model = registry.get(condition)
    inputs, sources, missing = assemble_inputs(db, user, condition, body.features, body.use_latest, model.features)
    unknown = {k: "not an input of this model" for k in body.features if k not in model.features}
    if unknown:
        raise ApiError(422, "validation_error", "Some inputs are not used by this model.", unknown)
    if missing:
        raise ApiError(422, "missing_inputs", "Some required inputs are missing; nothing is filled in automatically.", missing)
    row = run_and_store(db, registry, user.id, condition, inputs)
    audit(db, request, "prediction", user.id, {"condition": condition})  # no health values in the audit log
    db.commit()
    return {**prediction_out(row, condition, registry, db), "input_sources": sources}


@router.post("/diabetes", status_code=201)
def diabetes(body: PredictIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _predict("diabetes", body, request, user, db)


@router.post("/heart-disease", status_code=201)
def heart(body: PredictIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _predict("heart_disease", body, request, user, db)


@router.get("/history")
def history(request: Request, condition: str | None = Query(None, pattern="^(diabetes|heart_disease)$"),
            date_from: datetime | None = Query(None, alias="from"), date_to: datetime | None = Query(None, alias="to"),
            limit: int = Query(100, ge=1, le=500), user: User = Depends(current_user),
            db: Session = Depends(get_db)):
    """Time Machine source: real estimates only. Hypothetical what-if runs are excluded."""
    q = select(Prediction).where(Prediction.user_id == user.id, Prediction.is_hypothetical.is_(False))
    if date_from:
        q = q.where(Prediction.created_at >= date_from)
    if date_to:
        q = q.where(Prediction.created_at <= date_to)
    rows = db.scalars(q.order_by(Prediction.created_at.desc()).limit(limit)).all()
    items = [prediction_out(r, condition_of(db, r), request.app.state.registry, db) for r in rows]
    if condition:
        items = [i for i in items if i["condition"] == condition]
    return {"items": items}


def _owned(db: Session, user: User, prediction_id: uuid.UUID) -> Prediction:
    row = db.scalar(select(Prediction).where(Prediction.id == prediction_id, Prediction.user_id == user.id))
    if row is None:
        raise ApiError(404, "not_found", "Prediction not found.")
    return row


@router.get("/{prediction_id}")
def one(prediction_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = _owned(db, user, prediction_id)
    return prediction_out(row, condition_of(db, row), request.app.state.registry, db)


@router.get("/{prediction_id}/trust")
def trust(prediction_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = _owned(db, user, prediction_id)
    return {"prediction_id": str(row.id), "trust": row.trust,
            "note": "Agreement and range describe model behaviour on this input, not certainty about your health."}
