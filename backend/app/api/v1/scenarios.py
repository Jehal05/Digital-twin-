from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ApiError
from app.core.security import audit, current_user
from app.models.tables import Prediction, SimulationScenario, User
from app.schemas.api import GoalPlanIn, ScenarioIn
from app.services import goal_planner
from app.services.predictions import iso, prediction_out, run_and_store

router = APIRouter(prefix="/scenarios", tags=["scenarios"])
NOTE = "Hypothetical model output. A change in the model's estimate does not prove a real change in health."


def _baseline(db: Session, user: User, registry, condition: str, prediction_id: uuid.UUID) -> Prediction:
    base = db.scalar(select(Prediction).where(Prediction.id == prediction_id, Prediction.user_id == user.id))
    if base is None or base.is_hypothetical:
        raise ApiError(404, "not_found", "Baseline prediction not found.")
    model = registry.get(condition)
    mv = registry.version_row(db, condition)
    if base.model_version_id != mv.id:
        raise ApiError(409, "stale_baseline", "That baseline was made with an older model version. Run a new baseline first.")
    return base


def scenario_out(db: Session, registry, sc: SimulationScenario) -> dict:
    base, scen = db.get(Prediction, sc.baseline_prediction_id), db.get(Prediction, sc.scenario_prediction_id)
    return {
        "id": str(sc.id), "content_kind": "hypothetical", "kind": sc.kind, "name": sc.name, "condition": sc.condition,
        "target_score": sc.target_score, "changed_inputs": sc.changed_inputs,
        "baseline": prediction_out(base, sc.condition, registry, db), "scenario": prediction_out(scen, sc.condition, registry, db),
        "delta_pp": round((scen.score - base.score) * 100, 2), "note": NOTE, "created_at": iso(sc.created_at),
    }


def _save(db, request, user, registry, *, name, kind, condition, base, changes, target=None) -> SimulationScenario:
    """Re-runs the real model with only the changed inputs. The baseline row is never modified."""
    model = registry.get(condition)
    try:
        merged = {**base.input_snapshot, **changes}
        for k in changes:  # enforce editable-only before scoring
            if k not in model.schema:
                raise registry.InputValidationError({k: "not an input of this model"})
            if not model.schema[k]["editable"]:
                raise registry.InputValidationError({k: "not editable in the What-If Simulator"})
    except registry.InputValidationError as e:
        raise ApiError(422, "validation_error", "Some scenario inputs are not allowed.", e.fields) from None
    scen = run_and_store(db, registry, user.id, condition, merged, hypothetical=True)
    sc = SimulationScenario(user_id=user.id, name=name, kind=kind, target_score=target, condition=condition,
                            baseline_prediction_id=base.id, scenario_prediction_id=scen.id, changed_inputs=changes)
    db.add(sc)
    audit(db, request, "scenario_created", user.id, {"kind": kind, "condition": condition})
    db.commit()
    return sc


@router.post("", status_code=201)
def create(body: ScenarioIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    reg = request.app.state.registry
    base = _baseline(db, user, reg, body.condition, body.baseline_prediction_id)
    sc = _save(db, request, user, reg, name=body.name, kind="what_if", condition=body.condition, base=base,
               changes=body.changed_inputs)
    return scenario_out(db, reg, sc)


@router.post("/goal-plan")
def goal_plan(body: GoalPlanIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    reg = request.app.state.registry
    base = _baseline(db, user, reg, body.condition, body.baseline_prediction_id)
    if base.score <= body.target_score:
        raise ApiError(422, "validation_error", "The baseline estimate is already at or below that target.",
                       {"target_score": f"baseline estimate is {base.score:.2f}"})
    model = reg.get(body.condition)
    bad = [f for f in body.locked_inputs if f not in model.features]
    if bad:
        raise ApiError(422, "validation_error", "Unknown locked inputs.", {"locked_inputs": f"not model inputs: {bad}"})
    result = goal_planner.plan(model, body.condition, base.input_snapshot, body.target_score, set(body.locked_inputs))
    out = {"content_kind": "hypothetical", "condition": body.condition, "target_score": body.target_score,
           "baseline_score": base.score, **result}
    if not result["feasible"] or not result["changes"]:
        out["message"] = ("No combination of editable inputs within the realistic limits brings this model's estimate below the "
                          "target. The closest result found is shown; nothing was saved.")
        return out
    sc = _save(db, request, user, reg, name=f"Goal: below {body.target_score:.0%}", kind="goal_plan", condition=body.condition,
               base=base, changes=result["changes"], target=body.target_score)
    return {**out, "scenario": scenario_out(db, reg, sc)}


@router.get("")
def list_(request: Request, condition: str | None = Query(None, pattern="^(diabetes|heart_disease)$"),
          user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(SimulationScenario).where(SimulationScenario.user_id == user.id)
    if condition:
        q = q.where(SimulationScenario.condition == condition)
    rows = db.scalars(q.order_by(SimulationScenario.created_at.desc())).all()
    return {"items": [scenario_out(db, request.app.state.registry, r) for r in rows]}


def _owned(db: Session, user: User, scenario_id: uuid.UUID) -> SimulationScenario:
    sc = db.scalar(select(SimulationScenario).where(SimulationScenario.id == scenario_id, SimulationScenario.user_id == user.id))
    if sc is None:
        raise ApiError(404, "not_found", "Scenario not found.")
    return sc


@router.get("/{scenario_id}")
def one(scenario_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return scenario_out(db, request.app.state.registry, _owned(db, user, scenario_id))


@router.delete("/{scenario_id}", status_code=204)
def delete(scenario_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sc = _owned(db, user, scenario_id)
    scen_pred = db.get(Prediction, sc.scenario_prediction_id)
    db.delete(sc)
    db.flush()
    if scen_pred is not None and scen_pred.is_hypothetical:
        db.delete(scen_pred)  # the hypothetical run belongs only to this scenario; the baseline is untouched
    db.commit()
