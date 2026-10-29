from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ApiError
from app.core.security import audit, client_ip, current_user, sha256
from app.models.tables import HealthMeasurement, HealthProfile, Prediction, ShareLink, SimulationScenario, User
from app.schemas.api import ShareIn
from app.services.ml import CONDITIONS
from app.services.predictions import condition_of, iso

router = APIRouter(tags=["reports"])

DISCLAIMER = ("Experimental model estimates from small public research datasets. Not a diagnosis, not a medical device, and not "
              "a substitute for clinical judgement.")


def _age(dob) -> int | None:
    if dob is None:
        return None
    t = datetime.now(timezone.utc).date()
    return t.year - dob.year - ((t.month, t.day) < (dob.month, dob.day))


def build_report(db: Session, user: User, include: set[str], registry) -> dict:
    """Facts only, no names or emails. Every number comes from stored records."""
    out: dict = {"generated_at": iso(datetime.now(timezone.utc)), "disclaimer": DISCLAIMER, "sections": sorted(include)}
    if "profile" in include:
        p = db.get(HealthProfile, user.id)
        out["profile"] = {"age": _age(p.date_of_birth) if p else None, "sex": p.sex if p else None, "height_cm": p.height_cm if p else None}
    if "measurements" in include:
        since = datetime.now(timezone.utc) - timedelta(days=90)
        series: dict[str, list] = {}
        for m in db.scalars(select(HealthMeasurement).where(
                HealthMeasurement.user_id == user.id, HealthMeasurement.validation_status == "valid", HealthMeasurement.recorded_at >= since)
                .order_by(HealthMeasurement.recorded_at)):
            series.setdefault(m.measurement_type, []).append(m)
        out["measurements"] = [{
            "measurement_type": k, "unit": v[-1].unit, "count": len(v), "first": v[0].value, "latest": v[-1].value,
            "min": min(x.value for x in v), "max": max(x.value for x in v), "latest_at": iso(v[-1].recorded_at),
            "sources": sorted({x.source for x in v}), "content_kind": "measured"} for k, v in sorted(series.items())]
        out["measurement_window_days"] = 90
    if "estimates" in include:
        est = []
        for c in CONDITIONS:
            for r in db.scalars(select(Prediction).where(Prediction.user_id == user.id, Prediction.is_hypothetical.is_(False))
                                .order_by(Prediction.created_at.desc())):
                if condition_of(db, r) == c:
                    t = r.trust or {}
                    est.append({"condition": c, "score": r.score, "risk_band": r.risk_band, "created_at": iso(r.created_at),
                                "inputs": r.input_snapshot, "model_range": (t.get("uncertainty_range") or {}),
                                "top_drivers": [{"feature": d["feature"], "label": d["label"], "effect": d["effect"], "direction": d["direction"]}
                                                for d in (r.explanation or {}).get("top_drivers", [])[:3]],
                                "limitations": r.limitations or [], "content_kind": "ai_estimate"})
                    break
        out["estimates"] = est
        out["scenario_count"] = len(db.scalars(select(SimulationScenario.id).where(SimulationScenario.user_id == user.id)).all())
    return out


@router.get("/report")
def my_report(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return build_report(db, user, {"profile", "measurements", "estimates"}, request.app.state.registry)


def _link_out(l: ShareLink) -> dict:
    now = datetime.now(timezone.utc)
    return {"id": str(l.id), "include": l.scope["include"], "expires_at": iso(l.expires_at), "created_at": iso(l.created_at),
            "revoked": l.revoked_at is not None, "active": l.revoked_at is None and l.expires_at > now}


@router.post("/share", status_code=201)
def create_share(body: ShareIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    token = secrets.token_urlsafe(32)
    link = ShareLink(user_id=user.id, token_hash=sha256(token), scope={"include": sorted(set(body.include))},
                     expires_at=datetime.now(timezone.utc) + timedelta(days=body.expires_in_days))
    db.add(link)
    audit(db, request, "share_created", user.id, {"days": body.expires_in_days})
    db.commit()
    # The raw token is returned once. Only its hash is stored, so it cannot be shown again.
    return {**_link_out(link), "token": token, "path": f"/shared/{token}"}


@router.get("/share")
def list_shares(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(ShareLink).where(ShareLink.user_id == user.id).order_by(ShareLink.created_at.desc())).all()
    return {"items": [_link_out(r) for r in rows]}


@router.delete("/share/{link_id}", status_code=204)
def revoke(link_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    l = db.scalar(select(ShareLink).where(ShareLink.id == link_id, ShareLink.user_id == user.id))
    if l is None:
        raise ApiError(404, "not_found", "Share link not found.")
    if l.revoked_at is None:
        l.revoked_at = datetime.now(timezone.utc)
        audit(db, request, "share_revoked", user.id)
    db.commit()


@router.get("/shared/{token}")
def view_shared(token: str, request: Request, db: Session = Depends(get_db)):
    """Public, read-only. Unknown, expired and revoked links are indistinguishable."""
    request.app.state.share_limiter.check(f"shared:{client_ip(request)}")
    l = db.scalar(select(ShareLink).where(ShareLink.token_hash == sha256(token[:200])))
    if l is None or l.revoked_at is not None or l.expires_at <= datetime.now(timezone.utc):
        raise ApiError(404, "not_found", "This link is not available.")
    user = db.get(User, l.user_id)
    audit(db, request, "share_viewed", l.user_id)
    db.commit()
    return {**build_report(db, user, set(l.scope["include"]), request.app.state.registry), "shared": True,
            "expires_at": iso(l.expires_at)}
