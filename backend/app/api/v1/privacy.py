from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ApiError
from app.core.security import audit, current_user, verify_password
from app.models.tables import (AuditEvent, Consent, ExplainerMessage, HealthMeasurement, HealthProfile, Prediction, RefreshToken,
                               ShareLink, SimulationScenario, UploadedFile, User, UserPreference)
from app.schemas.api import ConsentIn, DeleteAccountIn
from app.services.predictions import iso

router = APIRouter(prefix="/privacy", tags=["privacy"])


def _rows(db, model, user_id, cols):
    return [{c: (iso(v) if hasattr(v, "isoformat") and hasattr(v, "tzinfo") else (str(v) if hasattr(v, "hex") else v))
             for c in cols for v in [getattr(r, c)]} for r in db.scalars(select(model).where(model.user_id == user_id))]


@router.get("/export")
def export(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Everything stored about the signed-in user (never other users' data). Password hash and tokens are excluded."""
    p = db.get(HealthProfile, user.id)
    data = {
        "exported_at": iso(datetime.now(timezone.utc)),
        "account": {"email": user.email, "display_name": user.display_name, "created_at": iso(user.created_at)},
        "profile": {"date_of_birth": p.date_of_birth.isoformat() if p and p.date_of_birth else None,
                    "sex": p.sex if p else None, "height_cm": p.height_cm if p else None},
        "consents": _rows(db, Consent, user.id, ["consent_type", "granted", "policy_version", "recorded_at"]),
        "measurements": _rows(db, HealthMeasurement, user.id, ["id", "measurement_type", "value", "unit", "recorded_at", "source",
                                                               "validation_status", "flag_reason"]),
        "predictions": _rows(db, Prediction, user.id, ["id", "score", "risk_band", "input_snapshot", "explanation", "trust",
                                                      "is_hypothetical", "created_at"]),
        "scenarios": _rows(db, SimulationScenario, user.id, ["id", "name", "kind", "condition", "changed_inputs", "target_score",
                                                            "created_at"]),
        "audit_events": _rows(db, AuditEvent, user.id, ["event_type", "created_at"]),
    }
    audit(db, request, "export", user.id)
    db.commit()
    return Response(json.dumps(data, indent=2), media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="healthtwin-export.json"'})


@router.delete("/account", status_code=202)
def delete_account(body: DeleteAccountIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Requires the password again. Removes the account and all its health data."""
    if not verify_password(user.password_hash, body.password):
        raise ApiError(403, "forbidden", "Password is incorrect.")
    uid = user.id
    # scenarios reference predictions, so they go first; the rest cascade from the user row
    for model in (SimulationScenario, Prediction, ExplainerMessage, ShareLink, RefreshToken, HealthMeasurement, UploadedFile,
                  Consent, UserPreference, HealthProfile):
        db.execute(delete(model).where(model.user_id == uid))
    db.execute(delete(AuditEvent).where(AuditEvent.user_id == uid))
    db.delete(user)
    audit(db, request, "account_deleted", None)  # anonymous record that a deletion happened; no user reference
    db.commit()
    return {"status": "deleted", "note": "Your account and health data have been permanently removed."}


@router.get("/consents")
def consents(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Latest decision per consent type, plus the full append-only history."""
    rows = db.scalars(select(Consent).where(Consent.user_id == user.id).order_by(Consent.recorded_at, Consent.id)).all()
    latest = {r.consent_type: {"granted": r.granted, "recorded_at": iso(r.recorded_at), "policy_version": r.policy_version} for r in rows}
    from app.api.v1.explain import provider_for
    return {"current": latest, "history_count": len(rows), "ai_explainer_available": provider_for(request) is not None}


@router.post("/consents", status_code=201)
def set_consent(body: ConsentIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Consent changes are appended, never edited, so there is a record of what was agreed and when."""
    db.add(Consent(user_id=user.id, consent_type=body.consent_type, granted=body.granted,
                   policy_version=request.app.state.settings.policy_version))
    audit(db, request, "consent_changed", user.id, {"type": body.consent_type, "granted": body.granted})
    db.commit()
    return {"consent_type": body.consent_type, "granted": body.granted}
