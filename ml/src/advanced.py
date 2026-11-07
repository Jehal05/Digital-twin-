"""Honest model comparison: nested cross-validation across four algorithm families.

Why nested: if the same folds both tune a model and score it, the score is optimistic. Here every outer fold is split
again; hyper-parameters are chosen only from the inner folds of the outer-training rows, and the outer test rows are
used once, for scoring. Probabilities are calibrated on rows the model did not train on.

Algorithms (all scikit-learn, no extra dependencies):
  logistic_regression        simple, transparent baseline
  random_forest              bagged trees
  hist_gradient_boosting     boosted trees (same algorithm family as LightGBM/XGBoost)
  neural_network             small multilayer perceptron

Nothing here picks a winner by looking at test rows: `choose_primary` uses the outer-fold scores, with a preference for
the simpler model unless a complex one is better by a margin that is also larger than the fold-to-fold noise.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.frozen import FrozenEstimator
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import GridSearchCV, StratifiedKFold, train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

SEED = 42
ALGOS = ("logistic_regression", "random_forest", "hist_gradient_boosting", "neural_network")
SIMPLICITY_ORDER = {a: i for i, a in enumerate(ALGOS)}   # lower = simpler


def preprocessor(features: list[str], categorical: frozenset[str] = frozenset(), scale: bool = True) -> ColumnTransformer:
    cat = [f for f in features if f in categorical]
    num = [f for f in features if f not in categorical]
    steps = [("impute", SimpleImputer(strategy="median"))] + ([("scale", StandardScaler())] if scale else [])
    parts = [("num", Pipeline(steps), num)]
    if cat:
        parts.append(("cat", Pipeline([("impute", SimpleImputer(strategy="most_frequent")),
                                       ("onehot", OneHotEncoder(handle_unknown="ignore"))]), cat))
    return ColumnTransformer(parts)


def make_pipeline(algo: str, features: list[str], categorical: frozenset[str] = frozenset(), quick: bool = False) -> Pipeline:
    if algo == "logistic_regression":
        clf, scale = LogisticRegression(max_iter=3000), True
    elif algo == "random_forest":
        clf, scale = RandomForestClassifier(n_estimators=80 if quick else 200, random_state=SEED, n_jobs=2), False
    elif algo == "hist_gradient_boosting":
        clf, scale = HistGradientBoostingClassifier(random_state=SEED, early_stopping=True, validation_fraction=0.15,
                                                    n_iter_no_change=15, max_iter=400), False
    elif algo == "neural_network":
        clf, scale = MLPClassifier(hidden_layer_sizes=(32, 16), early_stopping=True, validation_fraction=0.15, n_iter_no_change=10,
                                   max_iter=300, random_state=SEED), True
    else:
        raise ValueError(algo)
    return Pipeline([("pre", preprocessor(features, categorical, scale)), ("clf", clf)])


LARGE_GRIDS = {   # used for the 250k-row survey data, where every fit is expensive
    "logistic_regression": {"clf__C": [0.1, 1]},
    "random_forest": {"clf__max_depth": [8, 14], "clf__min_samples_leaf": [30]},
    "hist_gradient_boosting": {"clf__learning_rate": [0.05, 0.1], "clf__max_depth": [3, 5], "clf__l2_regularization": [1.0]},
    "neural_network": {"clf__alpha": [1e-3, 1e-1]},
}
GRIDS = {
    "logistic_regression": {"clf__C": [0.01, 0.1, 1, 10]},
    "random_forest": {"clf__max_depth": [4, 8, None], "clf__min_samples_leaf": [3, 10, 30]},
    "hist_gradient_boosting": {"clf__learning_rate": [0.03, 0.1], "clf__max_depth": [2, 4], "clf__l2_regularization": [0.0, 1.0]},
    "neural_network": {"clf__alpha": [1e-4, 1e-2, 1.0]},
}
QUICK_GRIDS = {
    "logistic_regression": {"clf__C": [0.1, 1]},
    "random_forest": {"clf__max_depth": [4, None], "clf__min_samples_leaf": [10]},
    "hist_gradient_boosting": {"clf__learning_rate": [0.1], "clf__max_depth": [3], "clf__l2_regularization": [1.0]},
    "neural_network": {"clf__alpha": [1e-2]},
}


def expected_calibration_error(y, p, bins: int = 10) -> float:
    """Average gap between predicted probability and observed frequency, weighted by bin size (quantile bins)."""
    y, p = np.asarray(y), np.asarray(p)
    order = np.argsort(p)
    ece = 0.0
    for chunk in np.array_split(order, min(bins, len(p))):
        if len(chunk):
            ece += len(chunk) / len(p) * abs(p[chunk].mean() - y[chunk].mean())
    return float(ece)


def fit_calibrated(pipe: Pipeline, X, y, small: bool, seed: int = SEED):
    """Fit `pipe` and return a sigmoid-calibrated model.

    small data: 5-fold cross-fitted calibration (every row helps train and calibrate).
    large data: fit on 85% of the rows and calibrate on the other 15%, which keeps training cost to one fit.
    """
    if small:
        return CalibratedClassifierCV(clone(pipe), method="sigmoid", cv=5, ensemble=False).fit(X, y)
    X_fit, X_cal, y_fit, y_cal = train_test_split(X, y, test_size=0.15, stratify=y, random_state=seed)
    fitted = clone(pipe).fit(X_fit, y_fit)
    return CalibratedClassifierCV(FrozenEstimator(fitted), method="sigmoid").fit(X_cal, y_cal)


def tune(algo: str, X, y, features, categorical, grids, quick: bool, tune_rows: int | None):
    """Pick hyper-parameters by inner cross-validation on (a sample of) the outer-training rows only."""
    pipe = make_pipeline(algo, features, categorical, quick)
    if tune_rows and len(X) > tune_rows:
        idx = np.random.default_rng(SEED).choice(len(X), tune_rows, replace=False)
        Xt, yt = X.iloc[idx], y.iloc[idx]
    else:
        Xt, yt = X, y
    inner = StratifiedKFold(3, shuffle=True, random_state=SEED)
    gs = GridSearchCV(pipe, grids[algo], scoring="roc_auc", cv=inner, n_jobs=1, refit=False)
    gs.fit(Xt, yt)
    return pipe.set_params(**gs.best_params_), {k.replace("clf__", ""): v for k, v in gs.best_params_.items()}


@dataclass
class FoldResult:
    name: str
    n_train: int
    n_test: int
    positive_rate_test: float
    scores: dict = field(default_factory=dict)       # algo -> metrics
    params: dict = field(default_factory=dict)       # algo -> chosen hyper-parameters


def run_split(X, y, train_idx, test_idx, name, features, categorical=frozenset(), algos=ALGOS, quick=False, small=True,
              tune_rows=None, grids=None) -> tuple[FoldResult, dict]:
    grids = grids or (QUICK_GRIDS if quick else GRIDS)
    Xtr, ytr, Xte, yte = X.iloc[train_idx][features], y.iloc[train_idx], X.iloc[test_idx][features], y.iloc[test_idx]
    res = FoldResult(name, len(train_idx), len(test_idx), round(float(yte.mean()), 4))
    probs = {}
    for algo in algos:
        t0 = time.time()
        pipe, best = tune(algo, Xtr, ytr, features, categorical, grids, quick, tune_rows)
        model = fit_calibrated(pipe, Xtr, ytr, small)
        p = model.predict_proba(Xte)[:, 1]
        probs[algo] = p
        auc = roc_auc_score(yte, p) if yte.nunique() > 1 else float("nan")
        res.scores[algo] = {"roc_auc": round(float(auc), 4), "brier": round(float(brier_score_loss(yte, p)), 4),
                            "log_loss": round(float(log_loss(yte, np.clip(p, 1e-6, 1 - 1e-6))), 4),
                            "ece": round(expected_calibration_error(yte, p), 4), "seconds": round(time.time() - t0, 1)}
        res.params[algo] = best
    return res, probs


def summarise(folds: list[FoldResult], algos=ALGOS) -> dict:
    """Mean and spread of each metric across folds, plus paired difference against the baseline (logistic regression)."""
    out = {}
    for algo in algos:
        row = {}
        for metric in ("roc_auc", "brier", "log_loss", "ece"):
            v = np.array([f.scores[algo][metric] for f in folds], dtype=float)
            v = v[~np.isnan(v)]
            row[metric] = {"mean": round(float(v.mean()), 4), "std": round(float(v.std(ddof=1)) if len(v) > 1 else 0.0, 4)}
        base = np.array([f.scores["logistic_regression"]["roc_auc"] for f in folds], dtype=float)
        me = np.array([f.scores[algo]["roc_auc"] for f in folds], dtype=float)
        ok = ~(np.isnan(base) | np.isnan(me))
        diff = (me - base)[ok]
        row["auc_gain_vs_logistic"] = {"mean": round(float(diff.mean()), 4),
                                       "std": round(float(diff.std(ddof=1)) if len(diff) > 1 else 0.0, 4),
                                       "folds_better": int((diff > 0).sum()), "folds": int(len(diff))}
        out[algo] = row
    return out


def choose_primary(summary: dict, margin: float = 0.01) -> tuple[str, str]:
    """The simplest model whose mean outer-fold AUC is within `margin` of the best. A more complex model is only chosen when
    it beats every simpler one by more than `margin`."""
    best = max(summary, key=lambda a: summary[a]["roc_auc"]["mean"])
    candidates = [a for a in summary if summary[best]["roc_auc"]["mean"] - summary[a]["roc_auc"]["mean"] <= margin]
    simplest = min(candidates, key=SIMPLICITY_ORDER.get)
    if simplest == best:
        return best, f"{best} has the highest mean AUC and is also the simplest within {margin:.2f} of the best."
    return simplest, (f"{best} scored highest (AUC {summary[best]['roc_auc']['mean']:.3f}) but only {summary[best]['roc_auc']['mean'] - summary[simplest]['roc_auc']['mean']:.3f} "
                      f"above {simplest}, within the {margin:.2f} simplicity margin, so the simpler model is kept.")
