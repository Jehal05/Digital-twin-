"""Twin Futures: two hypothetical six-month paths for the same person, scored month by month by the real trained model.

  carry on as now   each measured input continues along the person's own recorded trend (only when there are at least three
                    measurements over at least two weeks; otherwise it is held constant). Nothing else changes.
  improve habits    the Goal Planner's change (smallest realistic change that reaches the next lower band, or the best change it can
                    find) is phased in evenly over six months; yes/no habits switch on in month 1.

These are what-if paths, not forecasts: the model was trained on one-time snapshots of different people, so it cannot say how a
particular person's risk will evolve. Ageing is not modelled.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.tables import HealthMeasurement
from app.services import goal_planner
from app.services.features import MEASURED

MONTHS = 6
MIN_POINTS, MIN_SPAN_DAYS = 3, 14
NOTE = ("Hypothetical paths, not predictions. The model learned from snapshots of different people, so it cannot forecast how your own "
        "risk will change. Ageing and everything not listed under assumptions are held constant.")


def _trend(db: Session, user_id, mtype: str, current: float) -> tuple[float, str]:
    """Slope in units per day from the person's own recent measurements, or 0 with the reason."""
    rows = db.scalars(select(HealthMeasurement).where(HealthMeasurement.user_id == user_id, HealthMeasurement.measurement_type == mtype,
                                                      HealthMeasurement.validation_status != "rejected")
                      .order_by(HealthMeasurement.recorded_at.desc()).limit(12)).all()
    if len(rows) < MIN_POINTS:
        return 0.0, f"held constant ({len(rows)} measurement{'s' if len(rows) != 1 else ''}, at least {MIN_POINTS} needed for a trend)"
    t0 = min(r.recorded_at for r in rows)
    days = np.array([(r.recorded_at - t0).total_seconds() / 86400 for r in rows])
    if days.max() < MIN_SPAN_DAYS:
        return 0.0, f"held constant (measurements span under {MIN_SPAN_DAYS} days)"
    slope = float(np.polyfit(days, np.array([r.value for r in rows]), 1)[0])
    return slope, f"continues your recorded trend ({slope * 30:+.2f} per month, from {len(rows)} measurements)"


def build(db: Session, user_id, model, condition: str, base_inputs: dict, base_score: float) -> dict:
    schema = model.schema
    carry = {m: dict(base_inputs) for m in range(MONTHS + 1)}
    assumptions_carry = []
    for feature, mtype in MEASURED.get(condition, {}).items():
        if feature not in base_inputs or not schema[feature]["editable"]:
            continue
        slope, why = _trend(db, user_id, mtype, base_inputs[feature])
        assumptions_carry.append({"input": feature, "assumption": why})
        for m in range(MONTHS + 1):
            lo, hi = schema[feature]["min"], schema[feature]["max"]
            carry[m][feature] = float(np.clip(base_inputs[feature] + slope * 30 * m, lo, hi))

    lo_edge, hi_edge = model.b["schema"]["risk_band_edges"]
    target = round((lo_edge if base_score < hi_edge else hi_edge) - 0.001, 4) if base_score >= lo_edge else max(0.011, round(base_score - 0.02, 4))
    plan = goal_planner.plan(model, condition, base_inputs, target, set())
    improve = {m: dict(base_inputs) for m in range(MONTHS + 1)}
    habits = goal_planner.HABITS.get(condition, {})
    for feature, goal in plan["changes"].items():
        for m in range(MONTHS + 1):
            if feature in habits:
                improve[m][feature] = float(goal) if m >= 1 else float(base_inputs[feature])
            else:
                improve[m][feature] = round(base_inputs[feature] + (goal - base_inputs[feature]) * m / MONTHS, 2)

    def score(paths):
        return [round(float(v), 4) for v in model.score_batch(pd.DataFrame([paths[m] for m in range(MONTHS + 1)]))]

    return {"content_kind": "hypothetical", "condition": condition, "months": MONTHS,
            "carry_on": {"label": "Carry on as now", "scores": score(carry), "assumptions": assumptions_carry or [{"input": "all", "assumption": "held constant"}]},
            "improve": {"label": "Improve habits", "scores": score(improve),
                        "changes": plan["changes"], "reaches_target": plan["feasible"],
                        "assumptions": [{"input": f, "assumption": ("switches to the healthier answer in month 1 and stays" if f in habits
                                                                    else f"moves from {base_inputs[f]:g} to {v:g} evenly over {MONTHS} months")}
                                        for f, v in plan["changes"].items()]},
            "note": NOTE}
