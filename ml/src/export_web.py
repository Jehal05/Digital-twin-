"""Export the primary logistic-regression models to JSON so the browser can run them with no server call.

    python -m src.export_web            # writes frontend/public/models/<condition>.json and a parity file for the tests

The JSON holds exactly the numbers of the trained scikit-learn pipeline: median imputation, scaling, one-hot encoding, the
logistic coefficients and the sigmoid calibration (p = 1 / (1 + exp(a*f + b)), f = decision value). The browser applies the same
arithmetic. Parity is tested two ways: `reference_predict` (pure Python on the JSON) against scikit-learn, and the TypeScript
implementation against `parity.json` (probabilities produced by scikit-learn) at 1e-9.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / "frontend" / "public" / "models"


def _unwrap(est):
    while hasattr(est, "estimator") and not hasattr(est, "named_steps"):
        est = est.estimator
    return est


def export_bundle(bundle: dict) -> dict:
    if bundle["primary"] != "logistic_regression":
        raise ValueError(f"{bundle['condition']}: primary model is {bundle['primary']}; only logistic regression can run on-device")
    cal = bundle["models"]["logistic_regression"].calibrated_classifiers_[0]
    pipe = _unwrap(cal.estimator)
    pre, clf = pipe.named_steps["pre"], pipe.named_steps["clf"]
    num_cols = cat_cols = []
    num_imp = num_scale = cat_imp = ohe = None
    for name, tr, cols in pre.transformers_:
        if name == "num":
            num_cols, num_imp, num_scale = list(cols), tr.named_steps["impute"], tr.named_steps["scale"]
        elif name == "cat":
            cat_cols, cat_imp, ohe = list(cols), tr.named_steps["impute"], tr.named_steps["onehot"]
    coef = clf.coef_[0].tolist()
    terms = []
    for i, c in enumerate(num_cols):
        terms.append({"feature": c, "kind": "numeric", "median": float(num_imp.statistics_[i]), "mean": float(num_scale.mean_[i]),
                      "scale": float(num_scale.scale_[i]), "coef": coef[i]})
    k = len(num_cols)
    for j, c in enumerate(cat_cols):
        cats = [float(v) for v in ohe.categories_[j]]
        terms.append({"feature": c, "kind": "categorical", "mode": float(cat_imp.statistics_[j]), "categories": cats,
                      "coefs": coef[k:k + len(cats)]})
        k += len(cats)
    sig = cal.calibrators[0]
    return {"condition": bundle["condition"], "version": bundle["version"], "algorithm": "logistic_regression",
            "intercept": float(clf.intercept_[0]), "calibration": {"a": float(sig.a_), "b": float(sig.b_)},
            "terms": terms, "features": bundle["features"], "risk_band_edges": bundle["schema"]["risk_band_edges"],
            "schema": {f["name"]: {k: f[k] for k in ("label", "unit", "kind", "min", "max", "categories", "editable")} for f in bundle["schema"]["features"]},
            "note": "Experimental model estimate, not a diagnosis. Computed entirely on this device."}


def reference_predict(model: dict, row: dict) -> float:
    """Pure-Python evaluation of the exported JSON. Mirrors the TypeScript implementation line by line."""
    z = model["intercept"]
    for t in model["terms"]:
        v = row.get(t["feature"])
        if t["kind"] == "numeric":
            x = t["median"] if v is None or (isinstance(v, float) and math.isnan(v)) else float(v)
            z += t["coef"] * (x - t["mean"]) / t["scale"]
        else:
            x = t["mode"] if v is None or (isinstance(v, float) and math.isnan(v)) else float(v)
            if x in t["categories"]:
                z += t["coefs"][t["categories"].index(x)]
    a, b = model["calibration"]["a"], model["calibration"]["b"]
    return 1.0 / (1.0 + math.exp(a * z + b))


def main(artifacts: Path = ROOT / "artifacts", out: Path = OUT, n_parity: int = 60) -> None:
    out.mkdir(parents=True, exist_ok=True)
    parity = {}
    for cdir in sorted(p for p in artifacts.iterdir() if p.is_dir()):
        active = cdir / "ACTIVE"
        if not active.exists():
            continue
        version = active.read_text().strip()
        bundle = joblib.load(cdir / version / "model.joblib")
        spec = export_bundle(bundle)
        (out / f"{bundle['condition']}.json").write_text(json.dumps(spec, indent=1))
        # parity cases: real training-like rows (background sample) plus extremes of the allowed ranges
        rng = np.random.default_rng(7)
        bg = bundle["background"].reset_index(drop=True)
        rows = [bg.iloc[i % len(bg)][bundle["features"]].to_dict() for i in range(n_parity // 2)]
        for _ in range(n_parity - len(rows)):
            r = {}
            for f in bundle["schema"]["features"]:
                if f["kind"] in ("binary", "categorical"):
                    r[f["name"]] = float(rng.choice(f["categories"] or [0, 1]))
                else:
                    v = rng.uniform(f["min"], f["max"]); r[f["name"]] = float(round(v) if f["kind"] == "integer" else v)
            rows.append(r)
        X = pd.DataFrame(rows)[bundle["features"]]
        p = bundle["models"]["logistic_regression"].predict_proba(X)[:, 1]
        parity[bundle["condition"]] = [{"inputs": {k: (None if pd.isna(v) else float(v)) for k, v in r.items()}, "expected": float(pp)} for r, pp in zip(rows, p)]
        print(f"{bundle['condition']} v{version}: exported, {len(rows)} parity cases")
    (out.parent.parent / "src" / "test" / "parity.json").write_text(json.dumps(parity))


if __name__ == "__main__":
    main()
