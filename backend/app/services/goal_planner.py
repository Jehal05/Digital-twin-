"""Goal Planner (reverse What-If): find the smallest realistic change to editable inputs that brings the model's
estimate below a target. Every candidate is scored by the real trained model; nothing is hard-coded or extrapolated.
"""
from __future__ import annotations

import itertools

import numpy as np
import pandas as pd

# feature -> (largest decrease considered, floor it will not go below). Decreases only; these are conservative
# "realistic change" bounds for a simulation, not clinical targets.
REALISTIC = {
    "diabetes": {"glucose": (40.0, 70.0), "bmi": (5.0, 18.5), "blood_pressure": (15.0, 60.0)},
    "heart_disease": {"trestbps": (30.0, 90.0), "chol": (60.0, 125.0)},
    "diabetes_survey": {"bmi": (5.0, 18.5)},
}
# yes/no habits the planner may flip, with the value that is the "healthier" answer. Each flip costs as much as the largest
# continuous change, so the plan prefers fewer changes. The data only show association, never that a habit change causes a result.
HABITS = {
    "diabetes_survey": {"physical_activity": 1.0, "fruit_daily": 1.0, "veg_daily": 1.0, "smoker": 0.0, "heavy_alcohol": 0.0},
}
STEPS = 11
NOTE = ("Model-suggested hypothetical. It shows what changes to these inputs would move this model's estimate below your "
        "target; it is not medical advice and does not mean the changes would reduce real-world risk.")


def plan(model, condition: str, baseline: dict, target: float, locked: set[str]) -> dict:
    limits = REALISTIC[condition]
    habits = HABITS.get(condition, {})
    free = [f for f in model.editable_features() if (f in limits or f in habits) and f not in locked]
    axes: dict[str, np.ndarray] = {}
    for f in free:
        start = float(baseline[f])
        if f in habits:
            axes[f] = np.array([start, habits[f]]) if start != habits[f] else np.array([start])
            continue
        max_dec, floor = limits[f]
        lowest = max(floor, start - max_dec)
        axis = np.round(np.linspace(start, lowest, STEPS), 1) if lowest < start else np.array([start])
        axis[0] = start  # step 0 is exactly "no change", never a rounded copy of it
        axes[f] = axis

    combos = list(itertools.product(*[axes[f] for f in free])) or [()]
    rows = pd.DataFrame([{**baseline, **dict(zip(free, c))} for c in combos])
    scores = model.score_batch(rows)
    cost = np.zeros(len(rows))
    for f in free:
        cost += (rows[f].to_numpy() != float(baseline[f])) * 1.0 if f in habits else (float(baseline[f]) - rows[f].to_numpy()) / limits[f][0]

    feasible = np.where(scores <= target)[0]
    pick = None
    if len(feasible):
        best_cost = cost[feasible].min()
        near = feasible[np.isclose(cost[feasible], best_cost, atol=1e-9)]
        pick = int(near[np.argmin(scores[near])])
    closest = int(np.argmin(scores))
    chosen = pick if pick is not None else closest
    changes = {f: float(rows.loc[chosen, f]) for f in free if float(rows.loc[chosen, f]) != float(baseline[f])}
    return {
        "feasible": pick is not None,
        "changes": changes,
        "estimated_score": round(float(scores[chosen]), 4),
        "candidates_evaluated": int(len(rows)),
        "constraints": {f: ({"change_to": habits[f]} if f in habits else {"max_decrease": limits[f][0], "floor": limits[f][1]}) for f in free},
        "locked_inputs": sorted(locked),
        "note": NOTE,
    }
