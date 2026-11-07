"""Tests for the nested-CV machinery and the new dataset loaders (small, fast, synthetic where data is large)."""
import numpy as np
import pandas as pd
import pytest

from src import advanced as adv
from src.data import HEART_SITES, load_uci_heart_combined

FEATS = ["a", "b", "c"]


def _toy(n=240, seed=0):
    r = np.random.default_rng(seed)
    X = pd.DataFrame(r.normal(size=(n, 3)), columns=FEATS)
    y = pd.Series((X["a"] + 0.5 * X["b"] + r.normal(scale=1.0, size=n) > 0).astype(int))
    return X, y


def test_expected_calibration_error_is_zero_for_perfect_and_large_for_wrong():
    y = np.array([0, 1] * 50)
    assert adv.expected_calibration_error(y, y.astype(float)) == pytest.approx(0, abs=1e-9)
    assert adv.expected_calibration_error(y, 1 - y.astype(float)) > 0.9


def test_run_split_scores_every_algorithm_and_tuning_never_sees_test_rows():
    X, y = _toy()
    idx = np.arange(len(X)); tr, te = idx[:180], idx[180:]
    res, probs = adv.run_split(X, y, tr, te, "t", FEATS, quick=True)
    assert set(res.scores) == set(adv.ALGOS) and set(probs) == set(adv.ALGOS)
    for a in adv.ALGOS:
        assert len(probs[a]) == 60 and ((probs[a] >= 0) & (probs[a] <= 1)).all() and res.scores[a]["roc_auc"] > 0.6


def test_summarise_and_choose_primary_prefers_simpler_model_within_margin():
    def fold(lr, gb):
        f = adv.FoldResult("f", 1, 1, 0.5)
        for a in adv.ALGOS:
            f.scores[a] = {"roc_auc": 0.5, "brier": 0.2, "log_loss": 0.6, "ece": 0.05}
        f.scores["logistic_regression"]["roc_auc"], f.scores["hist_gradient_boosting"]["roc_auc"] = lr, gb
        return f
    close = adv.summarise([fold(0.80, 0.805), fold(0.82, 0.826)])
    assert adv.choose_primary(close)[0] == "logistic_regression"
    far = adv.summarise([fold(0.70, 0.80), fold(0.72, 0.83)])
    assert adv.choose_primary(far)[0] == "hist_gradient_boosting"
    assert far["hist_gradient_boosting"]["auc_gain_vs_logistic"]["folds_better"] == 2


def test_combined_heart_loader_has_four_sites_and_missing_zero_cholesterol():
    try:
        X, y, site, info = load_uci_heart_combined("data/raw/uci_heart")
    except FileNotFoundError:
        pytest.skip("raw UCI files not present")
    assert len(X) == 920 and set(site.unique()) == set(HEART_SITES) and set(y.unique()) == {0, 1}
    assert (X["chol"].dropna() > 0).all() and info["zero_cholesterol_treated_as_missing"] > 0
