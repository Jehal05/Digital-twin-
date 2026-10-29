from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ApiError
from app.core.security import audit, current_user
from app.models.tables import HealthMeasurement, User
from app.schemas.api import MeasurementIn, ResolveIn
from app.services import measurements as svc
from app.services.predictions import iso

router = APIRouter(prefix="/measurements", tags=["measurements"])


def out(m: HealthMeasurement) -> dict:
    return {"id": str(m.id), "content_kind": "measured", "measurement_type": m.measurement_type, "value": m.value, "unit": m.unit,
            "recorded_at": iso(m.recorded_at), "source": m.source, "validation_status": m.validation_status,
            "flag_reason": m.flag_reason, "created_at": iso(m.created_at)}


def _previous(db: Session, user_id, mtype: str, before: datetime):
    m = db.scalar(select(HealthMeasurement).where(
        HealthMeasurement.user_id == user_id, HealthMeasurement.measurement_type == mtype,
        HealthMeasurement.validation_status != "rejected", HealthMeasurement.recorded_at <= before)
        .order_by(HealthMeasurement.recorded_at.desc()).limit(1))
    return (m.value, m.recorded_at) if m else None


def _create(db: Session, user: User, body_type: str, value: float, unit: str, recorded_at: datetime) -> HealthMeasurement:
    try:
        canonical = svc.to_canonical(body_type, value, unit)
        svc.check_time(recorded_at, datetime.now(timezone.utc))
    except svc.MeasurementError as e:
        raise ApiError(422, "validation_error", "Measurement rejected.", {e.field: e.message}) from None
    recorded_at = recorded_at.astimezone(timezone.utc)
    dup = db.scalar(select(HealthMeasurement.id).where(
        HealthMeasurement.user_id == user.id, HealthMeasurement.measurement_type == body_type,
        HealthMeasurement.recorded_at == recorded_at, HealthMeasurement.value == canonical,
        HealthMeasurement.validation_status != "rejected"))
    if dup:
        raise ApiError(409, "duplicate", "This exact reading is already recorded.")
    reason = svc.anomaly_reason(body_type, canonical, recorded_at, _previous(db, user.id, body_type, recorded_at))
    m = HealthMeasurement(user_id=user.id, measurement_type=body_type, value=canonical, unit=svc.CATALOG[body_type].canonical_unit,
                          recorded_at=recorded_at, source="manual", validation_status="flagged" if reason else "valid",
                          flag_reason=reason)
    db.add(m)
    return m


@router.post("", status_code=201)
def add(body: MeasurementIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    m = _create(db, user, body.measurement_type, body.value, body.unit, body.recorded_at)
    db.commit()
    return out(m)


@router.get("")
def list_(measurement_type: str | None = None, date_from: datetime | None = Query(None, alias="from"),
          date_to: datetime | None = Query(None, alias="to"), limit: int = Query(100, ge=1, le=500),
          cursor: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(HealthMeasurement).where(HealthMeasurement.user_id == user.id, HealthMeasurement.validation_status != "rejected")
    if measurement_type:
        q = q.where(HealthMeasurement.measurement_type == measurement_type)
    if date_from:
        q = q.where(HealthMeasurement.recorded_at >= date_from)
    if date_to:
        q = q.where(HealthMeasurement.recorded_at <= date_to)
    if cursor:
        try:
            ts, mid = cursor.split("|")
            ts, mid = datetime.fromisoformat(ts), uuid.UUID(mid)
        except ValueError:
            raise ApiError(422, "validation_error", "Invalid cursor.", {"cursor": "invalid"}) from None
        q = q.where(or_(HealthMeasurement.recorded_at < ts, and_(HealthMeasurement.recorded_at == ts, HealthMeasurement.id < mid)))
    rows = db.scalars(q.order_by(HealthMeasurement.recorded_at.desc(), HealthMeasurement.id.desc()).limit(limit + 1)).all()
    page = rows[:limit]
    nxt = f"{page[-1].recorded_at.isoformat()}|{page[-1].id}" if len(rows) > limit else None
    return {"items": [out(m) for m in page], "next_cursor": nxt}


@router.get("/flagged")
def flagged(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(HealthMeasurement).where(
        HealthMeasurement.user_id == user.id, HealthMeasurement.validation_status == "flagged")
        .order_by(HealthMeasurement.recorded_at.desc())).all()
    return {"items": [out(m) for m in rows]}


@router.post("/{measurement_id}/resolve")
def resolve(measurement_id: uuid.UUID, body: ResolveIn, request: Request, user: User = Depends(current_user),
            db: Session = Depends(get_db)):
    m = db.scalar(select(HealthMeasurement).where(HealthMeasurement.id == measurement_id, HealthMeasurement.user_id == user.id))
    if m is None:
        raise ApiError(404, "not_found", "Measurement not found.")
    if m.validation_status != "flagged":
        raise ApiError(409, "conflict", "Only flagged measurements need to be resolved.")
    if body.action == "confirm":
        m.validation_status, m.flag_reason = "valid", None  # status only; the recorded value is never edited
        result = m
    else:
        if body.value is None:
            raise ApiError(422, "validation_error", "A corrected value is required.", {"value": "required"})
        m.validation_status = "rejected"  # the original row stays for audit; the correction is a NEW row
        db.flush()
        result = _create(db, user, m.measurement_type, body.value, body.unit or m.unit, m.recorded_at)
        result.validation_status, result.flag_reason = "valid", None
    audit(db, request, "measurement_resolved", user.id, {"action": body.action})
    db.commit()
    return out(result)
