"""Applicability check: "Is this model even for me?"

A model only knows the people it was trained on. We measure how unusual a person's inputs are, compared with the training
population, with the Mahalanobis distance (which accounts for correlations: a BMI of 18 and a glucose of 190 may each be
common but be rare together). The distance is converted to a percentile of the training population itself:
"X% of the training people were closer to the middle than you are".

Levels: typical (below the 95th percentile of training distances) | unusual (95th-99th) | outside (beyond the 99th, or any value
outside the training range / an unseen category). For 'unusual' and 'outside' the app dims the estimate and warns.

Honest limits: this only detects unusual INPUTS. It cannot know whether the model is wrong for a person who looks typical but
belongs to a group that the training data under-represents (for example another country or ethnicity).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

MAX_REF = 4000


def fit(X: pd.DataFrame, features: list[str], kinds: dict[str, str], seed: int = 42) -> dict:
    cols = [f for f in features if kinds[f] != "categorical"]
    A = X[cols].astype(float)
    med = A.median()
    A = A.fillna(med)
    mu = A.mean().to_numpy()
    sd = A.std(ddof=0).replace(0, 1).to_numpy()
    Z = (A.to_numpy() - mu) / sd
    cov = np.cov(Z, rowvar=False) if Z.shape[1] > 1 else np.array([[1.0]])
    cov = 0.95 * cov + 0.05 * np.eye(cov.shape[0])            # shrinkage keeps the inverse stable for binary columns
    inv = np.linalg.inv(cov)
    d = np.sqrt(np.einsum("ij,jk,ik->i", Z, inv, Z))
    ref = np.sort(d if len(d) <= MAX_REF else np.random.default_rng(seed).choice(d, MAX_REF, replace=False))
    cats = {f: sorted(float(v) for v in X[f].dropna().unique()) for f in features if kinds[f] == "categorical"}
    return {"cols": cols, "median": med.to_numpy(), "mu": mu, "sd": sd, "inv": inv, "ref": ref.astype(np.float32),
            "p95": float(np.percentile(d, 95)), "p99": float(np.percentile(d, 99)), "categories": cats, "n_train": int(len(X))}


def assess(x: pd.Series, a: dict, labels: dict[str, str], ranges: dict[str, tuple[float, float]]) -> dict:
    v = np.array([x[c] for c in a["cols"]], dtype=float)
    v = np.where(np.isnan(v), a["median"], v)
    z = (v - a["mu"]) / a["sd"]
    d = float(np.sqrt(z @ a["inv"] @ z))
    pct = float((a["ref"] < d).mean())
    reasons = []
    for c, val in zip(a["cols"], v):
        lo, hi = ranges[c]
        if val < lo or val > hi:
            reasons.append(f"{labels[c]} ({val:g}) is outside the range seen in training ({lo:g} to {hi:g}).")
    for c, seen in a["categories"].items():
        if not np.isnan(x[c]) and float(x[c]) not in seen:
            reasons.append(f"{labels[c]} was never seen in training.")
    level = "outside" if reasons or d > a["p99"] else "unusual" if d > a["p95"] else "typical"
    if level != "typical" and not reasons:
        top = sorted(zip(a["cols"], z), key=lambda t: -abs(t[1]))[:2]
        reasons = [f"{labels[c]} is {'higher' if s > 0 else 'lower'} than most training people (about {abs(s):.1f} standard deviations from the average)." for c, s in top]
    text = {"typical": "Your inputs look like the people this model was trained on.",
            "unusual": "Your inputs are less common in the training data, so treat this estimate with extra caution.",
            "outside": "Your inputs are unlike almost all the training people. This estimate is likely unreliable for you."}[level]
    return {"level": level, "distance_percentile": round(pct, 3), "text": text, "reasons": reasons,
            "limit": "This detects unusual inputs only. It cannot detect that a model was built on a population unlike you in ways not measured here.",
            "confidence_multiplier": {"typical": 1.0, "unusual": 0.6, "outside": 0.25}[level]}
