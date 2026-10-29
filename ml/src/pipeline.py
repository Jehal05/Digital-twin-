"""Training, evaluation, calibration and artifact export for one condition.

Rules this file enforces:
  * the held-out test set is split off first and used ONLY for final reporting;
  * model selection (hyper-parameters and LR-vs-RF) uses cross-validation on the training rows only;
  * all preprocessing (imputation, scaling, encoding) lives inside the sklearn Pipeline, so it is fit on training rows only;
  * probabilities are calibrated (sigmoid) on training data, and calibration is measured on the test set.
"""
from __future__ import annotations

import json
import platform
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap
import sklearn
from sklearn.base import clone
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, confusion_matrix, roc_auc_score, roc_curve
from sklearn.model_selection import GridSearchCV, StratifiedKFold, cross_val_predict, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from . import config as C

ALGORITHMS = ("logistic_regression", "random_forest")
GRIDS = {
    "logistic_regression": {"clf__C": [0.01, 0.1, 1, 10]},
    "random_forest": {"clf__max_depth": [3, 5, 8, None], "clf__min_samples_leaf": [1, 3, 5, 10]},
}
FAST_GRIDS = {
    "logistic_regression": {"clf__C": [0.1, 1]},
    "random_forest": {"clf__max_depth": [3, 5], "clf__min_samples_leaf": [3, 10]},
}


# --------------------------------------------------------------------------- building blocks
def build_preprocessor(features: list[str]) -> ColumnTransformer:
    cat = [f for f in features if f in C.CATEGORICAL_COLUMNS]
    num = [f for f in features if f not in cat]
    parts = [("num", Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler())]), num)]
    if cat:
        parts.append(("cat", Pipeline([("impute", SimpleImputer(strategy="most_frequent")),
                                       ("onehot", OneHotEncoder(handle_unknown="ignore"))]), cat))
    return ColumnTransformer(parts)


def make_pipeline(algo: str, features: list[str], fast: bool = False) -> Pipeline:
    if algo == "logistic_regression":
        clf = LogisticRegression(max_iter=2000)
    elif algo == "random_forest":
        clf = RandomForestClassifier(n_estimators=100 if fast else 300, random_state=C.SEED, n_jobs=1)
    else:
        raise ValueError(algo)
    return Pipeline([("pre", build_preprocessor(features)), ("clf", clf)])


def calibrated(pipe: Pipeline, cv: int = 5) -> CalibratedClassifierCV:
    # ensemble=False: one fitted base model; the sigmoid calibrator is learned from cross-validated predictions.
    return CalibratedClassifierCV(clone(pipe), method="sigmoid", cv=cv, ensemble=False)


def _downsample(a: np.ndarray, n: int = 60) -> list[float]:
    idx = np.unique(np.linspace(0, len(a) - 1, min(n, len(a))).astype(int))
    return [round(float(v), 4) for v in a[idx]]


def evaluate(y_true, prob, threshold: float) -> dict:
    y_true = np.asarray(y_true)
    pred = (np.asarray(prob) >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    div = lambda a, b: round(float(a / b), 4) if b else None  # noqa: E731
    return {
        "threshold": round(float(threshold), 4),
        "accuracy": div(tp + tn, len(y_true)),
        "sensitivity": div(tp, tp + fn),     # true positive rate
        "specificity": div(tn, tn + fp),     # true negative rate
        "precision": div(tp, tp + fp),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }


def probabilistic_metrics(y_true, prob) -> dict:
    fpr, tpr, _ = roc_curve(y_true, prob)
    frac_pos, mean_pred = calibration_curve(y_true, prob, n_bins=5, strategy="quantile")
    return {
        "roc_auc": round(float(roc_auc_score(y_true, prob)), 4),
        "brier_score": round(float(brier_score_loss(y_true, prob)), 4),
        "roc_curve": {"fpr": _downsample(fpr), "tpr": _downsample(tpr)},
        "calibration_curve": {"mean_predicted": [round(float(v), 4) for v in mean_pred],
                              "fraction_positive": [round(float(v), 4) for v in frac_pos]},
    }


def cohort_stats(X: pd.DataFrame, features) -> dict:
    out = {}
    for f in features:
        col = X[f.name].astype(float)
        entry = {"n_missing": int(col.isna().sum()), "min": float(col.min()), "max": float(col.max())}
        if f.kind == "categorical" or f.kind == "binary":
            entry["proportions"] = {str(k): round(float(v), 4) for k, v in col.value_counts(normalize=True).items()}
        else:
            entry["mean"] = round(float(col.mean()), 4)
            entry["percentile_grid"] = [round(float(v), 4) for v in np.nanpercentile(col.dropna(), np.arange(0, 101))]
        out[f.name] = entry
    return out


# --------------------------------------------------------------------------- main entry point
def train_condition(cond: C.Condition, X_all: pd.DataFrame, y: pd.Series, data_info: dict, out_root: Path,
                    version: str = "1.0.0", fast: bool = False) -> dict:
    features = [f.name for f in cond.features]
    grids = FAST_GRIDS if fast else GRIDS
    skf = StratifiedKFold(C.CV_FOLDS, shuffle=True, random_state=C.SEED)

    # 1. Split FIRST. The test set is not touched again until the final report.
    idx_train, idx_test = train_test_split(np.arange(len(X_all)), test_size=C.TEST_SIZE, stratify=y, random_state=C.SEED)
    X_train_all, X_test_all = X_all.iloc[idx_train], X_all.iloc[idx_test]
    y_train, y_test = y.iloc[idx_train], y.iloc[idx_test]
    X_train, X_test = X_train_all[features], X_test_all[features]

    # 2. Model selection by cross-validation on training rows only.
    searches = {}
    for algo in ALGORITHMS:
        gs = GridSearchCV(make_pipeline(algo, features, fast), grids[algo], scoring="roc_auc", cv=skf, n_jobs=-1, refit=True)
        gs.fit(X_train, y_train)
        best = gs.best_index_
        searches[algo] = {"search": gs, "cv_roc_auc": float(gs.best_score_),
                          "cv_roc_auc_std": float(gs.cv_results_["std_test_score"][best]), "best_params": gs.best_params_}
    lr_auc, rf_auc = searches["logistic_regression"]["cv_roc_auc"], searches["random_forest"]["cv_roc_auc"]
    primary = "random_forest" if rf_auc > lr_auc + C.LR_PREFERENCE_MARGIN else "logistic_regression"

    # 3. Calibrate both models on training data; compare both on the untouched test set.
    cal_models = {a: calibrated(searches[a]["search"].best_estimator_).fit(X_train, y_train) for a in ALGORITHMS}
    test_prob = {a: cal_models[a].predict_proba(X_test)[:, 1] for a in ALGORITHMS}

    # 4. Operating threshold (Youden J) per model, chosen from out-of-fold TRAINING predictions only,
    #    so each model is compared at its own training-derived threshold.
    op_thresholds = {}
    for a in ALGORITHMS:
        oof = cross_val_predict(calibrated(searches[a]["search"].best_estimator_), X_train, y_train, cv=skf,
                                method="predict_proba")[:, 1]
        fpr, tpr, thr = roc_curve(y_train, oof)
        op_thresholds[a] = float(np.clip(thr[1:][np.argmax((tpr - fpr)[1:])], 0.0, 1.0))
    op_threshold = op_thresholds[primary]

    comparison = {}
    for a in ALGORITHMS:
        prob_metrics = probabilistic_metrics(y_test, test_prob[a])
        cc = prob_metrics["calibration_curve"]
        gaps = np.abs(np.array(cc["mean_predicted"]) - np.array(cc["fraction_positive"]))
        comparison[a] = {
            "is_primary": a == primary,
            "best_params": {k.replace("clf__", ""): v for k, v in searches[a]["best_params"].items()},
            "cv_roc_auc_train": round(searches[a]["cv_roc_auc"], 4),
            "cv_roc_auc_std": round(searches[a]["cv_roc_auc_std"], 4),
            "test": {**prob_metrics,
                     "calibration_gap": {"mean_abs": round(float(gaps.mean()), 4), "max_abs": round(float(gaps.max()), 4)},
                     "at_0.5": evaluate(y_test, test_prob[a], 0.5),
                     "at_operating_threshold": evaluate(y_test, test_prob[a], op_thresholds[a])},
        }

    # 5. Permutation importance on the test set (model behaviour, not causation).
    pi = permutation_importance(cal_models[primary], X_test, y_test, scoring="roc_auc", n_repeats=20, random_state=C.SEED)
    importance = sorted(
        ({"feature": f, "mean_auc_drop": round(float(m), 4), "std": round(float(s), 4)}
         for f, m, s in zip(features, pi.importances_mean, pi.importances_std)),
        key=lambda d: -d["mean_auc_drop"])

    # 6. Feature-set sensitivity analysis (training CV only; informational, does not change the deployed set).
    sensitivity = {}
    for name, cols in cond.sensitivity_sets.items():
        sensitivity[name] = {}
        for algo, params in (("logistic_regression", {}), ("random_forest", {"clf__max_depth": 5, "clf__min_samples_leaf": 5})):
            p = make_pipeline(algo, cols, fast).set_params(**params)
            scores = cross_val_score(p, X_train_all[cols], y_train, scoring="roc_auc", cv=skf, n_jobs=-1)
            sensitivity[name][algo] = {"cv_roc_auc": round(float(scores.mean()), 4), "std": round(float(scores.std()), 4)}

    # 7. Bootstrap members for the Trust Meter uncertainty range.
    rng = np.random.default_rng(C.SEED)
    members = []
    for _ in range(C.N_BOOTSTRAP):
        b = rng.choice(len(X_train), len(X_train), replace=True)
        pipe = clone(searches[primary]["search"].best_estimator_)
        if primary == "random_forest":
            pipe.set_params(clf__n_estimators=60)
        members.append(calibrated(pipe, cv=3).fit(X_train.iloc[b], y_train.iloc[b]))
    member_test = np.column_stack([m.predict_proba(X_test)[:, 1] for m in members])
    q = np.percentile(member_test, [5, 95], axis=1)
    mean_width = float(np.mean(q[1] - q[0]))
    agreement_pp = np.abs(test_prob["logistic_regression"] - test_prob["random_forest"]) * 100

    # 8. Save versioned artifact bundle.
    out_dir = Path(out_root) / cond.key / version
    out_dir.mkdir(parents=True, exist_ok=True)
    background = X_train.sample(min(C.SHAP_BACKGROUND_ROWS, len(X_train)), random_state=C.SEED).reset_index(drop=True)
    schema = {
        "condition": cond.key, "version": version, "outcome_definition": cond.outcome_definition,
        "population_note": cond.population_note, "risk_band_edges": list(C.RISK_BAND_EDGES),
        "features": [vars(f) | {"categories": list(f.categories)} for f in cond.features],
    }
    stats = cohort_stats(X_train, cond.features)
    joblib.dump({
        "condition": cond.key, "version": version, "primary": primary, "features": features,
        "models": cal_models, "bootstrap": members, "background": background,
        "operating_threshold": op_threshold, "schema": schema, "cohort_stats": stats,
    }, out_dir / "model.joblib", compress=3)

    metrics = {
        "condition": cond.key, "version": version, "primary_algorithm": primary,
        "selection_rule": f"Random Forest only if its CV ROC-AUC beats Logistic Regression by more than {C.LR_PREFERENCE_MARGIN}; "
                          "otherwise the simpler Logistic Regression is used.",
        "split": {"train_rows": int(len(idx_train)), "test_rows": int(len(idx_test)),
                  "train_positive_rate": round(float(y_train.mean()), 4), "test_positive_rate": round(float(y_test.mean()), 4),
                  "test_index": [int(i) for i in idx_test]},
        "models": comparison, "operating_threshold": round(op_threshold, 4),
        "operating_thresholds": {a: round(v, 4) for a, v in op_thresholds.items()},
        "permutation_importance": importance, "feature_set_sensitivity": sensitivity,
        "trust_meter_on_test": {
            "mean_bootstrap_range_width": round(mean_width, 4),
            "mean_lr_rf_disagreement_pp": round(float(agreement_pp.mean()), 2),
            "share_disagreeing_over_10pp": round(float((agreement_pp > 10).mean()), 4),
        },
        "data": data_info,
    }
    manifest = {
        "version": version, "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "seed": C.SEED,
        "test_size": C.TEST_SIZE, "cv_folds": C.CV_FOLDS, "fast_mode": fast,
        "dependencies": {"python": platform.python_version(), "scikit-learn": sklearn.__version__,
                         "numpy": np.__version__, "pandas": pd.__version__, "shap": shap.__version__},
        "dataset": data_info, "intended_use": INTENDED_USE,
    }
    (out_dir / "feature_schema.json").write_text(json.dumps(schema, indent=2))
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    (out_dir / "cohort_stats.json").write_text(json.dumps(stats, indent=2))
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    (out_dir / "MODEL_CARD.md").write_text(model_card(cond, metrics, manifest))
    (Path(out_root) / cond.key / "ACTIVE").write_text(version)
    return {"out_dir": str(out_dir), "metrics": metrics}


INTENDED_USE = (
    "Educational and research demonstration of how a simple model's estimate changes with its inputs. "
    "NOT a medical device. Not for diagnosis, screening, treatment decisions or any clinical use."
)


def _pct(v):
    return "n/a" if v is None else f"{v * 100:.1f}%"


def model_card(cond: C.Condition, m: dict, manifest: dict) -> str:
    prim = m["primary_algorithm"]
    rows = []
    for algo, d in m["models"].items():
        t = d["test"]
        rows.append(f"| {algo.replace('_', ' ').title()}{' (primary)' if d['is_primary'] else ''} | {d['cv_roc_auc_train']:.3f} "
                    f"+/- {d['cv_roc_auc_std']:.3f} | {t['roc_auc']:.3f} | {t['brier_score']:.3f} | "
                    f"{_pct(t['at_0.5']['sensitivity'])} | {_pct(t['at_0.5']['specificity'])} | {_pct(t['at_0.5']['accuracy'])} |")
    p = m["models"][prim]["test"]
    cm5, cmo = p["at_0.5"]["confusion_matrix"], p["at_operating_threshold"]["confusion_matrix"]
    sens_rows = "\n".join(
        f"| {name} | {v['logistic_regression']['cv_roc_auc']:.3f} | {v['random_forest']['cv_roc_auc']:.3f} |"
        for name, v in m["feature_set_sensitivity"].items())
    feats = "\n".join(f"- **{f.name}**: {f.label}" + (f" ({f.unit})" if f.unit else "") +
                      (", editable in What-If" if f.editable else "") for f in cond.features)
    imp = ", ".join(f"{d['feature']} ({d['mean_auc_drop']:.3f})" for d in m["permutation_importance"][:3])
    return f"""# Model card: {cond.title} estimate, version {m['version']}

> **Experimental model estimate, not a diagnosis.** {manifest['intended_use']}

## What the number means
The model outputs a calibrated probability for this dataset label: *{cond.outcome_definition}*
It is **not** a personal prediction of future disease and it has **not** been clinically or externally validated.

## Data
- Dataset: {cond.dataset}
- File: `{m['data']['file']}`, SHA-256 `{m['data']['sha256'][:16]}...`
- Rows: {m['data']['rows']}, positives: {m['data']['positives']} ({_pct(m['data']['positive_rate'])})
- Population: {cond.population_note}
- Split: stratified {m['split']['train_rows']} train / {m['split']['test_rows']} test, seed {manifest['seed']}. Test rows were used only for the final report below.

## Inputs (primary feature set)
{feats}

## Method
- Preprocessing (imputation, scaling, one-hot encoding) is inside the pipeline and fit on training rows only.
- Logistic Regression and Random Forest were tuned by {manifest['cv_folds']}-fold cross-validation on training rows (ROC-AUC).
- Selection rule: {m['selection_rule']} **Selected: {prim.replace('_', ' ')}.**
- Probabilities are sigmoid-calibrated on training data.
- Operating threshold {m['operating_threshold']:.3f} was chosen on out-of-fold training predictions (Youden J).

## Held-out test results (threshold 0.5)
| Model | CV ROC-AUC (train) | Test ROC-AUC | Brier | Sensitivity | Specificity | Accuracy |
|---|---|---|---|---|---|---|
{chr(10).join(rows)}

Primary model confusion matrix at 0.5: TN {cm5['tn']}, FP {cm5['fp']}, **FN {cm5['fn']}**, TP {cm5['tp']}.
At the operating threshold {m['operating_threshold']:.3f}: TN {cmo['tn']}, FP {cmo['fp']}, **FN {cmo['fn']}**, TP {cmo['tp']}
(sensitivity {_pct(p['at_operating_threshold']['sensitivity'])}, specificity {_pct(p['at_operating_threshold']['specificity'])}).
False negatives (missed positives) matter most for a health screening-style use, so check them, not accuracy alone.

Calibration on the test set (5 quantile bins): mean absolute gap between predicted probability and observed frequency
{p['calibration_gap']['mean_abs']:.3f}, largest gap {p['calibration_gap']['max_abs']:.3f}. With only {m['split']['test_rows']} test rows
each bin holds about {m['split']['test_rows'] // 5} people, so treat this as a rough check, not proof of good calibration.

Most influential inputs by permutation importance on the test set (AUC drop): {imp}. This describes model behaviour, not medical causation.

## Feature-set sensitivity (training cross-validation ROC-AUC, informational)
| Feature set | Logistic Regression | Random Forest |
|---|---|---|
{sens_rows}

## Trust Meter (test set)
Mean width of the bootstrap range: {m['trust_meter_on_test']['mean_bootstrap_range_width']:.3f} probability.
Mean Logistic-vs-Forest disagreement: {m['trust_meter_on_test']['mean_lr_rf_disagreement_pp']:.1f} percentage points;
{_pct(m['trust_meter_on_test']['share_disagreeing_over_10pp'])} of test rows differ by more than 10 points.
The range reflects model-fitting variability on a small dataset, not a confidence interval for a person's true risk.

## Limitations
- Small public dataset, one population, one time period. Public benchmark data is not clinical validation.
- The test set is small, so every metric has wide uncertainty; do not over-read differences of a few points.
- What-If changes show how the model's estimate moves. They do not show that changing an input changes real health outcomes.
- Inputs must be measured the way the dataset measured them (see the feature descriptions above).
- Risk bands (low below 20%, moderate below 50%, otherwise high) are a display convention, not clinical categories.

## Reproducibility
Trained {manifest['trained_at']} with scikit-learn {manifest['dependencies']['scikit-learn']}, numpy {manifest['dependencies']['numpy']},
pandas {manifest['dependencies']['pandas']}, shap {manifest['dependencies']['shap']}, Python {manifest['dependencies']['python']}.
Re-run: `python -m src.train --condition {cond.key}`.
"""
