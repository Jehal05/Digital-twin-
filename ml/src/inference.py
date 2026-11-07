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
from . import conformal as K
from . import applicability as AP


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
        probs = {a: float(m.predict_proba(X)[0, 1]) for a, m in self.b["models"].items()}
        diff = (max(probs.values()) - min(probs.values())) * 100          # widest gap between any two model families
        lr, rf = probs.get("logistic_regression", p), probs.get("random_forest", p)
        extra = {}
        if self.b.get("conformal"):
            conf = self.b["conformal"]
            lo, hi = K.venn_abers(p, self.b["venn_abers"])
            low, high = min(lo, p), max(hi, p)
            rng = {"low": round(float(low), 4), "high": round(float(high), 4), "method": "venn_abers",
                   "note": "Venn-Abers range: the well-calibrated probability for inputs like yours lies inside it. A wide range means the "
                           "training data cannot pin the number down. It is not a confidence interval for your own true risk."}
            extra["conformal"] = K.describe_set(K.prediction_set(p, conf), 1 - conf["alpha"]) | {
                "guarantee": f"For people like the training data, the true outcome is inside this set at least {round((1 - conf['alpha']) * 100)}% of the time "
                             "(averaged over people; does not hold for people unlike the training data)."}
        else:
            boot = np.array([m.predict_proba(X)[0, 1] for m in self.b["bootstrap"]])
            low, high = np.percentile(boot, [5, 95])
            rng = {"low": round(float(min(low, p)), 4), "high": round(float(max(high, p)), 4), "method": "bootstrap_ensemble",
                   "note": "Spread of models refit on resampled training data; not a confidence interval for your true risk."}
        ood = []
        for name, st in self.b["cohort_stats"].items():
            if self.schema[name]["kind"] in ("continuous", "integer"):
                v = float(X[name].iloc[0])
                if v < st["min"] or v > st["max"]:
                    ood.append({"feature": name, "value": v, "training_range": [st["min"], st["max"]]})
        return {
            "model_agreement": {"logistic_regression": round(lr, 4), "random_forest": round(rf, 4),
                                "models": {a: round(v, 4) for a, v in probs.items()},
                                "difference_pp": round(diff, 1),
                                "level": "high" if diff < 5 else "medium" if diff < 10 else "low"},
            "uncertainty_range": rng,
            **extra,
            "out_of_distribution": ood,
            **({"applicability": AP.assess(X.iloc[0], self.b["applicability"], {n: s["label"] for n, s in self.schema.items()},
                                           {n: (st["min"], st["max"]) for n, st in self.b["cohort_stats"].items() if n in self.schema})}
               if self.b.get("applicability") else {}),
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

    def what_to_check_next(self, inputs: dict) -> dict:
        """Which input's accuracy matters most for THIS person's estimate?

        Every input is required, so none is "missing". Instead, each input in turn is replaced by values spread across the training
        population (its 1st to 99th percentiles, equally weighted) while everything else stays as entered. If the estimate hardly moves,
        a wrong or rough value for that input does not matter; if it swings or changes risk band, it is worth measuring carefully.
        No measurement error is assumed or invented: this is a sensitivity, using the real model and the real spread of the data.
        """
        X = self.validate(inputs)
        p0 = float(self.b["models"][self.primary].predict_proba(X)[0, 1])
        band0 = self._band(p0)
        out = []
        for f in self.features:
            st = self.b["cohort_stats"][f]
            spec = self.schema[f]
            if "percentile_grid" in st:
                grid = np.array(st["percentile_grid"][1:100], dtype=float)
            else:                                   # yes/no and category inputs: each value, in proportion to how common it is in training
                grid = np.concatenate([np.full(max(1, round(prop * 100)), float(k)) for k, prop in st["proportions"].items()])
            rows = pd.concat([X] * len(grid), ignore_index=True)
            rows[f] = grid
            pr = self.score_batch(rows)
            bands = np.array([self._band(float(v)) for v in pr])
            out.append({"feature": f, "label": spec["label"], "unit": spec["unit"], "value": float(X[f].iloc[0]),
                        "typical_swing_pp": round(float(np.mean(np.abs(pr - p0))) * 100, 2),
                        "range_pp": [round(float(np.percentile(pr, 5)) * 100, 1), round(float(np.percentile(pr, 95)) * 100, 1)],
                        "chance_band_changes": round(float(np.mean(bands != band0)), 3)})
        out.sort(key=lambda d: (-d["chance_band_changes"], -d["typical_swing_pp"]))
        for i, d in enumerate(out):
            d["rank"] = i + 1
        return {"content_kind": "ai_estimate", "baseline_score": round(p0, 4), "baseline_band": band0, "inputs": out,
                "method": "Sensitivity of the trained model to each input across the spread of the training population.",
                "note": "Shows which entries matter most to this model's estimate, so you know where an accurate measurement is most valuable. "
                        "It does not say what your true value is, and it is not medical advice. Experimental model estimate, not a diagnosis."}

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
