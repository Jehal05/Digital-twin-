"""Run the nested-CV comparison and write reports/<dataset>_comparison.{json,md}.

    python -m src.experiments heart            # combined 920-patient UCI data (+ leave-one-hospital-out checks)
    python -m src.experiments survey           # BRFSS 2015 survey model (253k respondents)
    add --quick for a fast smoke run (not for reporting)
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import RepeatedStratifiedKFold, StratifiedKFold

from . import advanced as A
from . import config as C
from .data import BRFSS_FEATURES, load_brfss, load_cleveland, load_uci_heart_combined

REPORTS = C.ROOT / "reports"
HEART_FEATURES = ["age", "sex", "cp", "trestbps", "chol", "fbs", "restecg", "thalach", "exang", "oldpeak"]
HEART_CATEGORICAL = frozenset({"cp", "restecg"})


def calibration_bins(y, p, bins=10):
    order = np.argsort(p)
    return [{"mean_predicted": round(float(p[c].mean()), 4), "observed": round(float(y[c].mean()), 4), "n": int(len(c))}
            for c in np.array_split(order, bins) if len(c)]


def subgroup_auc(y, p, groups: dict[str, np.ndarray]) -> dict:
    out = {}
    for name, mask in groups.items():
        if mask.sum() >= 30 and len(np.unique(y[mask])) == 2:
            out[name] = {"n": int(mask.sum()), "positive_rate": round(float(y[mask].mean()), 4),
                         "roc_auc": round(float(roc_auc_score(y[mask], p[mask])), 4)}
    return out


def pooled(y, probs, algos, groups):
    y = np.asarray(y)
    return {a: {"pooled_roc_auc": round(float(roc_auc_score(y, probs[a])), 4), "calibration_bins": calibration_bins(y, probs[a]),
                "subgroup_roc_auc": subgroup_auc(y, probs[a], groups)} for a in algos}


def save_oof(stem: str, y, probs: dict, order, extra: dict | None = None):
    """Out-of-fold predictions (every row predicted by models that never saw it). Used to build the model's evaluation."""
    REPORTS.mkdir(exist_ok=True)
    np.savez_compressed(REPORTS / f"{stem}_oof.npz", y=np.asarray(y), order=np.asarray(order),
                        **{f"p_{a}": v for a, v in probs.items()}, **(extra or {}))


def run_heart(quick: bool) -> dict:
    X, y, site, info = load_uci_heart_combined(C.RAW_DIR / "uci_heart")
    feats, cat = HEART_FEATURES, HEART_CATEGORICAL
    algos = A.ALGOS
    # 1. nested CV on all 920 patients (5 folds x 2 repeats, tuned inside each training part)
    rskf = RepeatedStratifiedKFold(n_splits=5, n_repeats=1 if quick else 2, random_state=A.SEED)
    folds, oof = [], {a: [] for a in algos}
    ys, sexes, idxs = [], [], []
    for i, (tr, te) in enumerate(rskf.split(X, y)):
        res, probs = A.run_split(X, y, tr, te, f"fold {i + 1}", feats, cat, algos, quick, small=True)
        folds.append(res)
        for a in algos:
            oof[a].append(probs[a])
        ys.append(y.iloc[te].to_numpy()); sexes.append(X.iloc[te]["sex"].to_numpy()); idxs.append(te)
        print(f"heart nested fold {i + 1}: " + ", ".join(f"{a} {res.scores[a]['roc_auc']:.3f}" for a in algos), flush=True)
    summary = A.summarise(folds, algos)
    primary, reason = A.choose_primary(summary)
    yy, ss = np.concatenate(ys), np.concatenate(sexes)
    pp = {a: np.concatenate(oof[a]) for a in algos}
    grp = {"male": ss == 1, "female": ss == 0}
    save_oof("heart" + ("_quick" if quick else ""), yy, pp, np.concatenate(idxs))

    # 2. external validation: leave one hospital out
    loso = {}
    for hold in ("cleveland", "hungarian", "switzerland", "va"):
        te = np.where(site == hold)[0]; tr = np.where(site != hold)[0]
        res, _ = A.run_split(X, y, tr, te, f"held out: {hold}", feats, cat, algos, quick, small=True)
        loso[hold] = {"n_test": res.n_test, "positive_rate_test": res.positive_rate_test,
                      "roc_auc": {a: res.scores[a]["roc_auc"] for a in algos}, "brier": {a: res.scores[a]["brier"] for a in algos}}
        print(f"heart held-out {hold}: " + ", ".join(f"{a} {loso[hold]['roc_auc'][a]:.3f}" for a in algos), flush=True)

    # 3. does more data help? the old Cleveland-only model vs the combined model, each tested on hospitals it never saw
    cl_tr = np.where(site == "cleveland")[0]
    old = {}
    for hold in ("hungarian", "switzerland", "va"):
        te = np.where(site == hold)[0]
        res, _ = A.run_split(X, y, cl_tr, te, f"cleveland-only -> {hold}", feats, cat, ("logistic_regression",), quick, small=True)
        others = np.where((site != hold))[0]
        res2, _ = A.run_split(X, y, others, te, f"all others -> {hold}", feats, cat, ("logistic_regression",), quick, small=True)
        old[hold] = {"cleveland_only_auc": res.scores["logistic_regression"]["roc_auc"],
                     "trained_on_other_three_hospitals_auc": res2.scores["logistic_regression"]["roc_auc"]}
    return {"dataset": "uci_heart_combined", "data": info, "features": feats, "algorithms": list(algos),
            "nested_cv": {"outer": f"{rskf.get_n_splits()} folds (5-fold x {rskf.n_repeats})", "inner": "3-fold grid search",
                          "summary": summary, "per_fold": [vars(f) for f in folds]},
            "chosen_primary": primary, "choice_reason": reason,
            "pooled_out_of_fold": pooled(yy, pp, algos, grp),
            "leave_one_hospital_out": loso, "cleveland_only_vs_combined": old}


def run_survey(quick: bool) -> dict:
    X, y, info = load_brfss(C.RAW_DIR / "brfss" / "diabetes_012_health_indicators_BRFSS2015.csv")
    if quick:
        keep = np.random.default_rng(A.SEED).choice(len(X), 20000, replace=False)
        X, y = X.iloc[keep].reset_index(drop=True), y.iloc[keep].reset_index(drop=True)
    feats, algos = BRFSS_FEATURES, A.ALGOS
    skf = StratifiedKFold(5, shuffle=True, random_state=A.SEED)
    folds, oof, ys, rows = [], {a: [] for a in algos}, [], []
    for i, (tr, te) in enumerate(skf.split(X, y)):
        res, probs = A.run_split(X, y, tr, te, f"fold {i + 1}", feats, frozenset(), algos, quick, small=False,
                                 tune_rows=2000 if quick else 25000, grids=A.QUICK_GRIDS if quick else A.LARGE_GRIDS)
        folds.append(res)
        for a in algos:
            oof[a].append(probs[a])
        ys.append(y.iloc[te].to_numpy()); rows.append(te)
        print(f"survey nested fold {i + 1}: " + ", ".join(f"{a} {res.scores[a]['roc_auc']:.4f} ({res.scores[a]['seconds']}s)" for a in algos), flush=True)
    summary = A.summarise(folds, algos)
    primary, reason = A.choose_primary(summary)
    order = np.concatenate(rows)
    yy = np.concatenate(ys); pp = {a: np.concatenate(oof[a]) for a in algos}
    save_oof("survey" + ("_quick" if quick else ""), yy, pp, order)
    Xo = X.iloc[order]
    age, sex = Xo["Age"].to_numpy(), Xo["Sex"].to_numpy()
    grp = {"women": sex == 0, "men": sex == 1, "age 18-44": age <= 5, "age 45-64": (age >= 6) & (age <= 10), "age 65+": age >= 11,
           "BMI under 25": Xo["BMI"].to_numpy() < 25, "BMI 25-29.9": (Xo["BMI"].to_numpy() >= 25) & (Xo["BMI"].to_numpy() < 30),
           "BMI 30+": Xo["BMI"].to_numpy() >= 30}
    return {"dataset": "brfss_2015", "data": info, "features": feats, "algorithms": list(algos),
            "nested_cv": {"outer": "5 folds", "inner": "3-fold grid search on a 25,000-row sample of each training part",
                          "summary": summary, "per_fold": [vars(f) for f in folds]},
            "chosen_primary": primary, "choice_reason": reason, "pooled_out_of_fold": pooled(yy, pp, algos, grp)}


def markdown(rep: dict) -> str:
    s = rep["nested_cv"]["summary"]
    lines = [f"# Nested cross-validation: {rep['dataset']}", "",
             f"Outer: {rep['nested_cv']['outer']}. Inner: {rep['nested_cv']['inner']}. Rows: {rep['data']['rows']}.", "",
             "| Algorithm | ROC-AUC (mean +/- sd) | Brier | Calibration error (ECE) | AUC gain vs logistic |", "|---|---|---|---|---|"]
    for a, r in s.items():
        g = r["auc_gain_vs_logistic"]
        lines.append(f"| {a.replace('_', ' ')} | {r['roc_auc']['mean']:.3f} +/- {r['roc_auc']['std']:.3f} | {r['brier']['mean']:.3f} | "
                     f"{r['ece']['mean']:.3f} | {g['mean']:+.3f} (better in {g['folds_better']}/{g['folds']} folds) |")
    lines += ["", f"**Chosen:** {rep['chosen_primary'].replace('_', ' ')}. {rep['choice_reason']}", ""]
    if "leave_one_hospital_out" in rep:
        lines += ["## Leave-one-hospital-out (external validation, ROC-AUC)", "", "| Held-out hospital | n | disease rate | " +
                  " | ".join(a.replace("_", " ") for a in rep["algorithms"]) + " |", "|---|---|---|" + "---|" * len(rep["algorithms"])]
        for h, r in rep["leave_one_hospital_out"].items():
            lines.append(f"| {h} | {r['n_test']} | {r['positive_rate_test']:.2f} | " + " | ".join(f"{r['roc_auc'][a]:.3f}" for a in rep["algorithms"]) + " |")
        lines += ["", "## Does pooling hospitals help? (logistic regression, tested on a hospital it never saw)", "",
                  "| Test hospital | Trained on Cleveland only | Trained on the other three hospitals |", "|---|---|---|"]
        for h, r in rep["cleveland_only_vs_combined"].items():
            lines.append(f"| {h} | {r['cleveland_only_auc']:.3f} | {r['trained_on_other_three_hospitals_auc']:.3f} |")
    lines += ["", "## Subgroup ROC-AUC (pooled out-of-fold predictions)", ""]
    p = rep["chosen_primary"]
    for g, r in rep["pooled_out_of_fold"][p]["subgroup_roc_auc"].items():
        lines.append(f"- {g}: AUC {r['roc_auc']:.3f} (n={r['n']}, rate {r['positive_rate']:.2f})")
    return "\n".join(lines) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset", choices=["heart", "survey"])
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args(argv)
    t0 = time.time()
    rep = run_heart(a.quick) if a.dataset == "heart" else run_survey(a.quick)
    rep["run"] = {"quick": a.quick, "minutes": round((time.time() - t0) / 60, 1), "seed": A.SEED}
    REPORTS.mkdir(exist_ok=True)
    stem = f"{a.dataset}_comparison" + ("_quick" if a.quick else "")
    (REPORTS / f"{stem}.json").write_text(json.dumps(rep, indent=1))
    (REPORTS / f"{stem}.md").write_text(markdown(rep))
    print(markdown(rep))


if __name__ == "__main__":
    main()
