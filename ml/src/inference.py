"""Inference used by the backend: strict validation, calibrated score, Trust Meter, SHAP explanation.

This is the only code path that produces a risk number. There are no hard-coded scores or formulas.
"""
from __future__ import annotations

import math
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap

from . import config as C


class InputValidationError(ValueError):
    def __init__(self, fields: dict[str, str]):
        self.fields = fields
        super().__init__("; ".join(f"{k}: {v}" for k, v in fields.items()))


class HealthTwinModel:
    def __init__(self, bundle: dict, root: Path):
        self.b = bundle
        self.features = bundle["features"]
        self.schema = {f["name"]: f for f in bundle["schema"]["features"]}
        self.condition = bundle["condition"]
        self.version = bundle["version"]
        self.primary = bundle["primary"]
        self._explainer = None

    @classmethod
    def load(cls, condition: str, version: str | None = None, artifact_dir: Path = C.ARTIFACT_DIR) -> "HealthTwinModel":
        base = Path(artifact_dir) / condition
        version = version or (base / "ACTIVE").read_text().strip()
        return cls(joblib.load(base / version / "model.joblib"), base)

    # ------------------------------------------------------------------ validation
    def validate(self, inputs: dict) -> pd.DataFrame:
        errors: dict[str, str] = {}
        unknown = set(inputs) - set(self.features)
        for k in sorted(unknown):
            errors[k] = "not an input of this model"
        row = {}
        for name in self.features:
            spec = self.schema[name]
            if name not in inputs or inputs[name] is None:
                errors[name] = "required"
                continue
            v = inputs[name]
            if isinstance(v, bool) or not isinstance(v, (int, float, np.integer, np.floating)) or not math.isfinite(float(v)):
                errors[name] = "must be a finite number"
                continue
            v = float(v)
            kind = spec["kind"]
            if kind in ("binary", "categorical"):
                allowed = spec["categories"] or [0, 1]
                if v not in allowed:
                    errors[name] = f"must be one of {list(allowed)}"
                    continue
            elif not (spec["min"] <= v <= spec["max"]):
                errors[name] = f"must be between {spec['min']} and {spec['max']} {spec['unit']}".strip()
                continue
            if kind == "integer" and v != int(v):
                errors[name] = "must be a whole number"
                continue
            row[name] = v
        if errors:
            raise InputValidationError(errors)
        return pd.DataFrame([row], columns=self.features)

    # ------------------------------------------------------------------ prediction
    def _band(self, p: float) -> str:
        lo, hi = C.RISK_BAND_EDGES
        return "low" if p < lo else "moderate" if p < hi else "high"

    def _trust(self, X: pd.DataFrame, p: float) -> dict:
        lr = float(self.b["models"]["logistic_regression"].predict_proba(X)[0, 1])
        rf = float(self.b["models"]["random_forest"].predict_proba(X)[0, 1])
        diff = abs(lr - rf) * 100
        boot = np.array([m.predict_proba(X)[0, 1] for m in self.b["bootstrap"]])
        low, high = np.percentile(boot, [5, 95])
        ood = []
        for name, st in self.b["cohort_stats"].items():
            if self.schema[name]["kind"] in ("continuous", "integer"):
                v = float(X[name].iloc[0])
                if v < st["min"] or v > st["max"]:
                    ood.append({"feature": name, "value": v, "training_range": [st["min"], st["max"]]})
        return {
            "model_agreement": {"logistic_regression": round(lr, 4), "random_forest": round(rf, 4),
                                "difference_pp": round(diff, 1),
                                "level": "high" if diff < 5 else "medium" if diff < 10 else "low"},
            "uncertainty_range": {"low": round(float(min(low, p)), 4), "high": round(float(max(high, p)), 4),
                                  "method": "bootstrap_ensemble",
                                  "note": "Spread of models refit on resampled training data; not a confidence interval for your true risk."},
            "out_of_distribution": ood,
        }

    def _explain(self, X: pd.DataFrame, top_k: int = 5) -> dict:
        if self._explainer is None:
            model = self.b["models"][self.primary]
            cols = self.features
            fn = lambda a: model.predict_proba(pd.DataFrame(a, columns=cols))[:, 1]  # noqa: E731
            self._explainer = shap.Explainer(fn, self.b["background"].to_numpy(dtype=float))
        ex = self._explainer(X.to_numpy(dtype=float))
        vals = ex.values[0]
        drivers = sorted(
            ({"feature": f, "label": self.schema[f]["label"], "value": float(X[f].iloc[0]), "unit": self.schema[f]["unit"],
              "effect": round(float(v), 4), "direction": "raises" if v > 0 else "lowers"}
             for f, v in zip(self.features, vals)), key=lambda d: -abs(d["effect"]))[:top_k]
        return {"method": "shap", "output": "calibrated probability (0-1)", "base_value": round(float(np.ravel(ex.base_values)[0]), 4),
                "top_drivers": drivers,
                "reference": "Effects are measured against a typical profile in the training data (base_value). An input can 'lower' "
                             "the estimate simply by being below that dataset average; it does not mean the value is protective.",
                "note": "Describes how this model's output depends on each input. It does not show medical causation."}

    def limitations(self) -> list[str]:
        return [
            "Experimental model estimate, not a diagnosis.",
            self.b["schema"]["population_note"],
            f"Outcome in the training data: {self.b['schema']['outcome_definition']}",
            "Trained on a small public dataset that has not been clinically validated.",
        ]

    def score_batch(self, rows: pd.DataFrame) -> np.ndarray:
        """Score many already-validated rows at once with the real primary model (used by the Goal Planner)."""
        return self.b["models"][self.primary].predict_proba(rows[self.features])[:, 1]

    def editable_features(self) -> list[str]:
        return [n for n, s in self.schema.items() if s["editable"]]

    def predict(self, inputs: dict, explain: bool = True) -> dict:
        X = self.validate(inputs)
        p = float(self.b["models"][self.primary].predict_proba(X)[0, 1])
        out = {
            "content_kind": "ai_estimate",
            "condition": self.condition,
            "score": round(p, 4),
            "risk_band": self._band(p),
            "model": {"version": self.version, "algorithm": self.primary},
            "input_snapshot": {k: float(v) for k, v in X.iloc[0].items()},
            "trust": self._trust(X, p),
            "limitations": self.limitations(),
        }
        if explain:
            out["explanation"] = self._explain(X)
        return out

    def compare(self, baseline: dict, changes: dict) -> dict:
        """What-If: re-run the real model with only the editable inputs changed. Baseline is never modified."""
        for k in changes:
            if k not in self.schema:
                raise InputValidationError({k: "not an input of this model"})
            if not self.schema[k]["editable"]:
                raise InputValidationError({k: "not editable in the What-If Simulator"})
        scenario_inputs = {**baseline, **changes}
        base, scen = self.predict(baseline), self.predict(scenario_inputs)
        return {
            "content_kind": "hypothetical", "baseline": base, "scenario": scen, "changed_inputs": dict(changes),
            "delta_pp": round((scen["score"] - base["score"]) * 100, 2),
            "note": "Hypothetical model output. A change in the model's estimate does not prove a real health change.",
        }
