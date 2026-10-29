from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models.tables import Prediction
from app.services.ml import ModelRegistry


def iso(dt) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def run_and_store(db: Session, registry: ModelRegistry, user_id, condition: str, inputs: dict,
                  hypothetical: bool = False, explain: bool = True) -> Prediction:
    model = registry.get(condition)
    try:
        result = model.predict(inputs, explain=explain)
    except registry.InputValidationError as e:
        raise ApiError(422, "validation_error", "Some model inputs are invalid.", e.fields) from None
    row = Prediction(
        user_id=user_id, model_version_id=registry.version_row(db, condition).id, input_snapshot=result["input_snapshot"],
        score=result["score"], risk_band=result["risk_band"], explanation=result.get("explanation"), trust=result["trust"],
        limitations=result["limitations"], is_hypothetical=hypothetical)
    db.add(row)
    db.flush()
    return row


def prediction_out(row: Prediction, condition: str, registry: ModelRegistry, db: Session | None = None) -> dict:
    from app.models.tables import ModelVersion  # local import avoids a cycle at module load
    mv = db.get(ModelVersion, row.model_version_id) if db is not None else None
    return {
        "id": str(row.id),
        "content_kind": "hypothetical" if row.is_hypothetical else "ai_estimate",
        "condition": condition,
        "score": row.score,
        "risk_band": row.risk_band,
        "model": {"version": mv.version if mv else registry.get(condition).version, "algorithm": mv.algorithm if mv else None},
        "input_snapshot": row.input_snapshot,
        "explanation": row.explanation,
        "trust": row.trust,
        "limitations": row.limitations,
        "created_at": iso(row.created_at),
    }


def condition_of(db: Session, row: Prediction) -> str:
    from app.models.tables import ModelVersion
    return db.get(ModelVersion, row.model_version_id).condition
