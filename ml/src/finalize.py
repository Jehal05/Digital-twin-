"""Train the deployed version-2 models from a finished nested-CV experiment.

    python -m src.finalize heart --version 2.0.0
    python -m src.finalize survey --version 1.0.0

How the numbers are produced (this is what the Model Reliability page and the model card report):
  * Performance comes from OUT-OF-FOLD predictions of the nested cross-validation: every row was predicted by models that
    never saw it, and hyper-parameters were chosen only inside each training part. There is no separate "test set" to get
    lucky or unlucky on, which is what made the first heart model's 0.95 AUC (on 61 rows) so optimistic.
  * The deployed models are then refit on ALL rows with the hyper-parameters most often chosen in the outer folds.
  * The operating threshold is chosen on the pooled out-of-fold predictions, so sensitivity/specificity at that threshold
    are slightly optimistic. The model card says so.
"""
from __future__ import annotations

import argparse
import json
import platform
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap
import sklearn
from sklearn.base import clone
from sklearn.metrics import roc_auc_score, roc_curve
from sklearn.model_selection import StratifiedKFold

from . import advanced as A
from . import config as C
from .data import load_brfss, load_uci_heart_combined
from .experiments import HEART_CATEGORICAL, REPORTS
from .pipeline import INTENDED_USE, cohort_stats, evaluate, probabilistic_metrics

RUNS = {
    "heart": dict(cond=C.HEART_V2, categorical=HEART_CATEGORICAL, small=True, bootstrap=20, perm_rows=None),
    "survey": dict(cond=C.SURVEY, categorical=frozenset(), small=False, bootstrap=8, perm_rows=60000),
}


def _load(kind: str, raw_dir: Path):
    if kind == "heart":
        X, y, site, info = load_uci_heart_combined(raw_dir / "uci_heart")
        info["zeros_treated_as_missing"] = {"chol": info["zero_cholesterol_treated_as_missing"],
                                            "trestbps": info["zero_resting_bp_treated_as_missing"]}
        return X, y, info
    X, y, info = load_brfss(raw_dir / "brfss" / "diabetes_012_health_indicators_BRFSS2015.csv")
    info["zeros_treated_as_missing"] = {}
    return X.rename(columns=C.BRFSS_RENAME), y, info


def modal_params(report: dict, algo: str) -> dict:
    """The hyper-parameters chosen most often across the outer folds."""
    counts = Counter(json.dumps(f["params"][algo], sort_keys=True) for f in report["nested_cv"]["per_fold"])
    return json.loads(counts.most_common(1)[0][0])


def pipeline_with(algo: str, params: dict, features, categorical):
    pipe = A.make_pipeline(algo, features, categorical)
    return pipe.set_params(**{f"clf__{k}": v for k, v in params.items()})


def oof_permutation_importance(pipe, X, y, features, rows: int | None, repeats: int = 5) -> list[dict]:
    """Mean ROC-AUC drop when a column is shuffled in held-out rows (5-fold CV). Describes model reliance, not causation."""
    if rows and len(X) > rows:
        idx = np.random.default_rng(A.SEED).choice(len(X), rows, replace=False)
        X, y = X.iloc[idx].reset_index(drop=True), y.iloc[idx].reset_index(drop=True)
    drops = {f: [] for f in features}
    rng = np.random.default_rng(A.SEED)
    for tr, te in StratifiedKFold(5, shuffle=True, random_state=A.SEED).split(X, y):
        fitted = clone(pipe).fit(X.iloc[tr][features], y.iloc[tr])
        Xte, yte = X.iloc[te][features], y.iloc[te]
        base = roc_auc_score(yte, fitted.predict_proba(Xte)[:, 1])
        for f in features:
            for _ in range(repeats):
                Xp = Xte.copy()
                Xp[f] = rng.permutation(Xp[f].to_numpy())
                drops[f].append(base - roc_auc_score(yte, fitted.predict_proba(Xp)[:, 1]))
    return sorted(({"feature": f, "mean_auc_drop": round(float(np.mean(v)), 4), "std": round(float(np.std(v)), 4)}
                   for f, v in drops.items()), key=lambda d: -d["mean_auc_drop"])


def train_final(kind: str, version: str, raw_dir: Path = C.RAW_DIR, out_root: Path = C.ARTIFACT_DIR,
                report_path: Path | None = None) -> dict:
    run = RUNS[kind]
    cond: C.Condition = run["cond"]
    features = [f.name for f in cond.features]
    report = json.loads((report_path or REPORTS / f"{kind}_comparison.json").read_text())
    oof = np.load(REPORTS / f"{kind}_oof.npz")
    algos = report["algorithms"]
    primary = report["chosen_primary"]
    X, y, info = _load(kind, raw_dir)
    X = X[features]
    categorical = run["categorical"]
    yy = oof["y"]
    n = len(yy)

    # --- evaluation from out-of-fold predictions
    summary = report["nested_cv"]["summary"]
    models_eval, op_thr = {}, {}
    for a in algos:
        p = oof[f"p_{a}"]
        fpr, tpr, thr = roc_curve(yy, p)
        op_thr[a] = float(np.clip(thr[1:][np.argmax((tpr - fpr)[1:])], 0.0, 1.0))
        pm = probabilistic_metrics(yy, p)
        cc = pm["calibration_curve"]
        gaps = np.abs(np.array(cc["mean_predicted"]) - np.array(cc["fraction_positive"]))
        models_eval[a] = {
            "is_primary": a == primary, "best_params": modal_params(report, a),
            "cv_roc_auc_train": summary[a]["roc_auc"]["mean"], "cv_roc_auc_std": summary[a]["roc_auc"]["std"],
            "test": {**pm, "calibration_gap": {"mean_abs": round(float(gaps.mean()), 4), "max_abs": round(float(gaps.max()), 4)},
                     "at_0.5": evaluate(yy, p, 0.5), "at_operating_threshold": evaluate(yy, p, op_thr[a])},
        }

    # --- refit the deployed models on all rows
    cal, pipes = {}, {}
    for a in algos:
        pipes[a] = pipeline_with(a, modal_params(report, a), features, categorical)
        cal[a] = A.fit_calibrated(pipes[a], X, y, run["small"])
    rng = np.random.default_rng(A.SEED)
    members = []
    for _ in range(run["bootstrap"]):
        b = rng.choice(len(X), len(X), replace=True)
        members.append(A.fit_calibrated(pipes[primary], X.iloc[b].reset_index(drop=True), y.iloc[b].reset_index(drop=True), run["small"]))
    sample = X.sample(min(2000, len(X)), random_state=A.SEED)
    member_p = np.column_stack([m.predict_proba(sample)[:, 1] for m in members])
    q = np.percentile(member_p, [5, 95], axis=1)
    lr_rf = np.abs(oof["p_logistic_regression"] - oof["p_random_forest"]) * 100

    importance = oof_permutation_importance(pipes[primary], X, y, features, run["perm_rows"])

    out_dir = Path(out_root) / cond.key / version
    out_dir.mkdir(parents=True, exist_ok=True)
    background = X.sample(min(C.SHAP_BACKGROUND_ROWS, len(X)), random_state=A.SEED).reset_index(drop=True)
    schema = {"condition": cond.key, "version": version, "outcome_definition": cond.outcome_definition,
              "population_note": cond.population_note, "risk_band_edges": list(C.RISK_BAND_EDGES),
              "features": [vars(f) | {"categories": list(f.categories)} for f in cond.features]}
    stats = cohort_stats(X, cond.features)
    joblib.dump({"condition": cond.key, "version": version, "primary": primary, "features": features, "models": cal,
                 "bootstrap": members, "background": background, "operating_threshold": op_thr[primary], "schema": schema,
                 "cohort_stats": stats}, out_dir / "model.joblib", compress=3)

    metrics = {
        "condition": cond.key, "version": version, "primary_algorithm": primary, "evaluation_basis": "nested_cross_validation",
        "selection_rule": f"Nested cross-validation across {len(algos)} algorithms; the simplest model within 0.01 ROC-AUC of the best "
                          f"is kept. {report['choice_reason']}",
        "split": {"scheme": "nested cross-validation: every row held out once", "train_rows": n, "test_rows": n,
                  "train_positive_rate": round(float(y.mean()), 4), "test_positive_rate": round(float(y.mean()), 4)},
        "models": models_eval, "operating_threshold": round(op_thr[primary], 4),
        "operating_thresholds": {a: round(v, 4) for a, v in op_thr.items()},
        "permutation_importance": importance, "feature_set_sensitivity": {},
        "nested_cv": report["nested_cv"]["summary"], "nested_cv_design": {k: report["nested_cv"][k] for k in ("outer", "inner")},
        "subgroup_roc_auc": report["pooled_out_of_fold"][primary]["subgroup_roc_auc"],
        "external_validation": {"leave_one_hospital_out": report.get("leave_one_hospital_out"),
                                "cleveland_only_vs_combined": report.get("cleveland_only_vs_combined")} if kind == "heart" else None,
        "trust_meter_on_test": {"mean_bootstrap_range_width": round(float(np.mean(q[1] - q[0])), 4),
                                "mean_lr_rf_disagreement_pp": round(float(lr_rf.mean()), 2),
                                "share_disagreeing_over_10pp": round(float((lr_rf > 10).mean()), 4)},
        "data": info,
    }
    manifest = {"version": version, "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "seed": A.SEED,
                "dependencies": {"python": platform.python_version(), "scikit-learn": sklearn.__version__, "numpy": np.__version__,
                                 "pandas": pd.__version__, "shap": shap.__version__},
                "dataset": info, "intended_use": INTENDED_USE, "cv_folds": 5, "fast_mode": False}
    (out_dir / "feature_schema.json").write_text(json.dumps(schema, indent=2))
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    (out_dir / "cohort_stats.json").write_text(json.dumps(stats, indent=2))
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    (out_dir / "MODEL_CARD.md").write_text(model_card(cond, metrics, manifest, kind))
    (Path(out_root) / cond.key / "ACTIVE").write_text(version)
    return {"out_dir": str(out_dir), "metrics": metrics}


def _pct(v):
    return "n/a" if v is None else f"{v * 100:.1f}%"


def model_card(cond: C.Condition, m: dict, manifest: dict, kind: str) -> str:
    prim = m["primary_algorithm"]
    rows = []
    for a, s in m["nested_cv"].items():
        g = s["auc_gain_vs_logistic"]
        rows.append(f"| {a.replace('_', ' ')}{' (primary)' if a == prim else ''} | {s['roc_auc']['mean']:.3f} +/- {s['roc_auc']['std']:.3f} | "
                    f"{s['brier']['mean']:.3f} | {s['ece']['mean']:.3f} | {g['mean']:+.3f} (better in {g['folds_better']}/{g['folds']}) |")
    p = m["models"][prim]["test"]
    cmo = p["at_operating_threshold"]["confusion_matrix"]
    feats = "\n".join(f"- **{f.name}**: {f.label}" + (f" ({f.unit})" if f.unit else "") + (", editable in What-If" if f.editable else "")
                      for f in cond.features)
    imp = ", ".join(f"{d['feature']} ({d['mean_auc_drop']:.3f})" for d in m["permutation_importance"][:4])
    sub = "\n".join(f"- {g}: ROC-AUC {r['roc_auc']:.3f} (n={r['n']}, outcome rate {_pct(r['positive_rate'])})"
                    for g, r in m["subgroup_roc_auc"].items())
    ext = ""
    if m.get("external_validation"):
        lo = m["external_validation"]["leave_one_hospital_out"]
        oc = m["external_validation"]["cleveland_only_vs_combined"]
        ext = ("\n## External validation: leave one hospital out (ROC-AUC)\nTrain on three hospitals, test on the fourth.\n\n"
               "| Held-out hospital | Patients | Disease rate | " + " | ".join(a.replace("_", " ") for a in lo["cleveland"]["roc_auc"]) + " |\n"
               "|---|---|---|" + "---|" * len(lo["cleveland"]["roc_auc"]) + "\n" +
               "\n".join(f"| {h} | {r['n_test']} | {_pct(r['positive_rate_test'])} | " + " | ".join(f"{v:.3f}" for v in r["roc_auc"].values()) + " |"
                         for h, r in lo.items()) +
               "\n\nDoes adding more hospitals help? Logistic regression, tested on a hospital it never saw:\n\n"
               "| Test hospital | Trained on Cleveland only (old model) | Trained on the other three hospitals |\n|---|---|---|\n" +
               "\n".join(f"| {h} | {r['cleveland_only_auc']:.3f} | {r['trained_on_other_three_hospitals_auc']:.3f} |" for h, r in oc.items()) +
               "\n\nThe model transfers well between Cleveland and Hungary but clearly worse to Switzerland and the VA sample "
               "(different patients, different test practices and missing data). Expect a similar drop for anyone unlike these patients.\n")
    d = m["data"]
    return f"""# Model card: {cond.title}, version {m['version']}

> **Experimental model estimate, not a diagnosis.** {manifest['intended_use']}

## What the number means
The model outputs a calibrated probability for this dataset label: *{cond.outcome_definition}*
It is **not** a personal prediction of future disease and it has **not** been clinically validated.

## Data
- Dataset: {cond.dataset}
- Rows used: {d['rows']}, with the outcome: {d['positives']} ({_pct(d['positive_rate'])})
- Population: {cond.population_note}

## Inputs
{feats}

## How it was evaluated (nested cross-validation)
Outer: {m['nested_cv_design']['outer']}. Inner: {m['nested_cv_design']['inner']}. Hyper-parameters were chosen only inside
each training part; every row was then predicted by models that never saw it. Probabilities are sigmoid-calibrated.
Compared: logistic regression, random forest, histogram gradient boosting and a small neural network.

| Algorithm | ROC-AUC (mean +/- sd over folds) | Brier | Calibration error | AUC gain vs logistic regression |
|---|---|---|---|---|
{chr(10).join(rows)}

**Selected: {prim.replace('_', ' ')}.** {m['selection_rule']}

A more complex model is only worth deploying if it wins clearly. If the gains above are within one fold-to-fold standard
deviation, they are noise, not evidence.

## Mistakes at the operating threshold {m['operating_threshold']:.3f}
Out of {m['split']['test_rows']} out-of-fold predictions: TN {cmo['tn']}, FP {cmo['fp']}, **FN {cmo['fn']}**, TP {cmo['tp']}
(sensitivity {_pct(p['at_operating_threshold']['sensitivity'])}, specificity {_pct(p['at_operating_threshold']['specificity'])}).
The threshold was chosen on these same predictions, so these two rates are slightly optimistic.

Calibration (5 quantile bins of out-of-fold predictions): mean absolute gap {p['calibration_gap']['mean_abs']:.3f}, largest {p['calibration_gap']['max_abs']:.3f}.

Most influential inputs (permutation importance, AUC drop): {imp}. This describes model behaviour, not medical causation.

## Performance by subgroup (ROC-AUC, out-of-fold)
{sub}
Differences between subgroups mean the estimate is more reliable for some people than others.
{ext}
## Trust Meter
Mean bootstrap range width {m['trust_meter_on_test']['mean_bootstrap_range_width']:.3f}; mean logistic-vs-forest disagreement
{m['trust_meter_on_test']['mean_lr_rf_disagreement_pp']:.1f} percentage points ({_pct(m['trust_meter_on_test']['share_disagreeing_over_10pp'])} of rows over 10 points).

## Limitations
- Public benchmark data is not clinical validation, and the data are old or from one country.
- What-If changes show how the model's estimate moves, not that changing a habit changes real health outcomes.
- Inputs must be measured the way the dataset measured them (see the feature descriptions).
- Risk bands (low below 20%, moderate below 50%, otherwise high) are a display convention, not clinical categories.
{"- Self-reported survey answers; the outcome is an existing diagnosis, so undiagnosed diabetes is counted as 'no diabetes'. Income, education and insurance were deliberately left out so the estimate cannot depend on them." if kind == "survey" else "- Cholesterol recorded as 0 (172 patients) and a few resting blood-pressure zeros were treated as missing and imputed inside each training part."}

## Reproducibility
Trained {manifest['trained_at']} with scikit-learn {manifest['dependencies']['scikit-learn']}, numpy {manifest['dependencies']['numpy']},
pandas {manifest['dependencies']['pandas']}, Python {manifest['dependencies']['python']}.
Re-run: `python -m src.experiments {kind}` then `python -m src.finalize {kind} --version {m['version']}`.
"""


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=list(RUNS))
    ap.add_argument("--version", required=True)
    a = ap.parse_args(argv)
    res = train_final(a.kind, a.version)
    m = res["metrics"]
    print(f"[{a.kind}] primary={m['primary_algorithm']} nested AUC={m['nested_cv'][m['primary_algorithm']]['roc_auc']['mean']} -> {res['out_dir']}")


if __name__ == "__main__":
    main()
