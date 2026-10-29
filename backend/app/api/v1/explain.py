from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ApiError
from app.core.security import audit, current_user
from app.explainer import service
from app.models.tables import Consent, Prediction, User
from app.schemas.api import ExplainIn
from app.services.predictions import condition_of, prediction_out

router = APIRouter(tags=["explainer"])


def has_ai_consent(db: Session, user_id) -> bool:
    latest = db.scalar(select(Consent).where(Consent.user_id == user_id, Consent.consent_type == "ai_explainer")
                       .order_by(Consent.recorded_at.desc(), Consent.id.desc()).limit(1))
    return bool(latest and latest.granted)


def provider_for(request: Request):
    s = request.app.state.settings
    override = getattr(request.app.state, "explainer_provider", None)
    if override is not None:
        return override
    if s.anthropic_api_key:
        from app.explainer.llm import AnthropicProvider
        return AnthropicProvider(s.anthropic_api_key, s.anthropic_model)
    return None


@router.post("/explain")
def explain(body: ExplainIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.scalar(select(Prediction).where(Prediction.id == body.prediction_id, Prediction.user_id == user.id))
    if row is None:
        raise ApiError(404, "not_found", "Prediction not found.")
    reg = request.app.state.registry
    cond = condition_of(db, row)
    pred = prediction_out(row, cond, reg, db)
    pred["editable_inputs"] = reg.get(cond).editable_features()
    consent = has_ai_consent(db, user.id)
    result = service.answer(pred, body.topic, body.question, provider_for(request), consent)
    audit(db, request, "explain", user.id, {"source": result["source"], "refused": result["refused"]})
    db.commit()
    return {**result, "content_kind": "ai_estimate" if not row.is_hypothetical else "hypothetical", "cited_prediction_id": str(row.id)}
