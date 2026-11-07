"""Uncertainty with stated guarantees: conformal prediction sets and Venn-Abers probability ranges.

Both are calibrated on OUT-OF-FOLD predictions (every calibration row was scored by a model that never saw it).

Conformal prediction set (class-conditional split conformal, alpha = 0.10)
    For a new person exchangeable with the calibration data, the set contains their true outcome at least 90% of the time,
    separately for people who do and do not have the outcome. The set is {higher}, {lower}, {both} ("too close to call") or {}.
    The guarantee is marginal (averaged over people), needs exchangeability, and does NOT hold under population shift.
    Using out-of-fold scores rather than a single held-out calibration split makes it approximate (as in cross-conformal
    prediction); `evaluate_coverage` measures what actually happens.

Venn-Abers range
    Two isotonic recalibrations, one assuming the new person's outcome is 0 and one assuming it is 1, give [p0, p1]. The
    well-calibrated probability lies in that range (validity theorem of Vovk & Petej), so a wide range means the data cannot
    pin the probability down. Unlike a bootstrap range, it needs no resampling and widens when calibration data is scarce.
"""
from __future__ import annotations

import math

import numpy as np
from sklearn.isotonic import IsotonicRegression

ALPHA = 0.10
MAX_VA_POINTS = 6000


def _quantile(scores: np.ndarray, alpha: float) -> float:
    n = len(scores)
    k = math.ceil((n + 1) * (1 - alpha))
    return float("inf") if k > n else float(np.sort(scores)[k - 1])


def fit_conformal(y, p, alpha: float = ALPHA) -> dict:
    y, p = np.asarray(y), np.asarray(p, dtype=float)
    # nonconformity of a label = 1 - probability the model gave that label
    q1 = _quantile(1 - p[y == 1], alpha)
    q0 = _quantile(p[y == 0], alpha)                  # 1 - (1 - p) = p
    return {"alpha": alpha, "q": {"0": q0, "1": q1}, "n_class": {"0": int((y == 0).sum()), "1": int((y == 1).sum())},
            "method": "class-conditional split conformal on out-of-fold scores"}


def prediction_set(p: float, conf: dict) -> list[int]:
    out = []
    if p <= conf["q"]["0"]:            # label 0 is plausible when 1 - (1 - p) <= q0
        out.append(0)
    if 1 - p <= conf["q"]["1"]:
        out.append(1)
    return out


def describe_set(s: list[int], coverage: float) -> dict:
    pct = round(coverage * 100)
    if s == [1]:
        k, text = "higher", f"At {pct}% reliability the model points to the higher-risk outcome."
    elif s == [0]:
        k, text = "lower", f"At {pct}% reliability the model points to the lower-risk outcome."
    elif s == [0, 1]:
        k, text = "undecided", f"Too close to call: at {pct}% reliability the model cannot rule out either outcome for these inputs."
    else:
        k, text = "unusual", "Neither outcome is plausible to the model for these inputs, which suggests an unusual combination of values."
    return {"outcome_set": s, "verdict": k, "coverage": coverage, "text": text}


def fit_venn_abers(y, p, seed: int = 42) -> dict:
    """Store a (sub-sampled, stratified) sorted calibration set. Sub-sampling keeps requests fast."""
    y, p = np.asarray(y), np.asarray(p, dtype=float)
    if len(p) > MAX_VA_POINTS:
        idx = np.random.default_rng(seed).choice(len(p), MAX_VA_POINTS, replace=False)
        y, p = y[idx], p[idx]
    o = np.argsort(p)
    return {"scores": p[o].astype(np.float32), "labels": y[o].astype(np.int8)}


def venn_abers(p: float, va: dict) -> tuple[float, float]:
    s = np.append(va["scores"], p)
    out = []
    for lab in (0, 1):
        labels = np.append(va["labels"], lab)
        out.append(float(IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip").fit(s, labels).predict([p])[0]))
    p0, p1 = out
    return p0, p1


def evaluate_coverage(y, p, alpha: float = ALPHA, repeats: int = 200, seed: int = 42) -> dict:
    """Empirical check of the guarantee: calibrate on a random half, test on the other half, repeat."""
    y, p = np.asarray(y), np.asarray(p, dtype=float)
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(repeats):
        perm = rng.permutation(len(y)); a, b = perm[: len(y) // 2], perm[len(y) // 2:]
        rows.append(_score(fit_conformal(y[a], p[a], alpha), y[b], p[b]))
    keys = rows[0].keys()
    return {k: {"mean": round(float(np.mean([r[k] for r in rows])), 4), "std": round(float(np.std([r[k] for r in rows])), 4)} for k in keys} \
        | {"target_coverage": 1 - alpha, "repeats": repeats, "design": "calibrate on a random half of the out-of-fold predictions, test on the other half"}


def _score(conf: dict, y, p) -> dict:
    sets = [prediction_set(v, conf) for v in p]
    hit = np.array([int(t) in s for t, s in zip(y, sets)])
    size = np.array([len(s) for s in sets])
    return {"coverage": float(hit.mean()), "coverage_if_outcome_present": float(hit[y == 1].mean()) if (y == 1).any() else float("nan"),
            "coverage_if_outcome_absent": float(hit[y == 0].mean()) if (y == 0).any() else float("nan"),
            "share_decided": float((size == 1).mean()), "share_undecided": float((size == 2).mean()), "share_empty": float((size == 0).mean())}


def coverage_under_shift(y, p, groups: np.ndarray, alpha: float = ALPHA) -> dict:
    """Calibrate on all groups but one, test on the held-out group. Shows where the guarantee stops holding."""
    y, p, groups = np.asarray(y), np.asarray(p, dtype=float), np.asarray(groups)
    out = {}
    for g in np.unique(groups):
        te = groups == g
        if te.sum() < 30 or len(np.unique(y[te])) < 2:
            continue
        s = _score(fit_conformal(y[~te], p[~te], alpha), y[te], p[te])
        out[str(g)] = {"n": int(te.sum()), **{k: round(v, 4) for k, v in s.items() if k in ("coverage", "coverage_if_outcome_present", "coverage_if_outcome_absent", "share_decided")}}
    return out


def range_width_stats(y, p, va: dict, n: int = 400, seed: int = 42) -> dict:
    p = np.asarray(p, dtype=float)
    idx = np.random.default_rng(seed).choice(len(p), min(n, len(p)), replace=False)
    w = np.array([np.subtract(*venn_abers(float(p[i]), va)[::-1]) for i in idx])
    return {"mean_width": round(float(w.mean()), 4), "median_width": round(float(np.median(w)), 4), "rows": int(len(idx))}
