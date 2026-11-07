import numpy as np
import pytest

from src import conformal as K


def _data(n=4000, seed=1):
    r = np.random.default_rng(seed)
    p = r.beta(0.8, 2.5, n)                     # a perfectly calibrated model: y ~ Bernoulli(p)
    return (r.random(n) < p).astype(int), p


def test_coverage_meets_the_stated_guarantee_on_exchangeable_data():
    y, p = _data()
    ev = K.evaluate_coverage(y, p, repeats=60)
    assert ev["coverage"]["mean"] >= 0.89
    assert ev["coverage_if_outcome_present"]["mean"] >= 0.88 and ev["coverage_if_outcome_absent"]["mean"] >= 0.88


def test_set_logic():
    conf = {"q": {"0": 0.3, "1": 0.4}}
    assert K.prediction_set(0.9, conf) == [1]
    assert K.prediction_set(0.05, conf) == [0]
    assert K.prediction_set(0.5, conf) == []
    assert K.prediction_set(0.5, {"q": {"0": 0.6, "1": 0.6}}) == [0, 1]
    assert K.describe_set([0, 1], 0.9)["verdict"] == "undecided"


def test_small_calibration_set_gives_a_conservative_infinite_quantile():
    conf = K.fit_conformal(np.array([0, 1] * 4), np.linspace(0.1, 0.9, 8), 0.05)
    assert conf["q"]["1"] == float("inf") or conf["q"]["0"] == float("inf")


def test_venn_abers_range_contains_a_calibrated_probability_and_widens_with_less_data():
    y, p = _data(3000)
    big = K.fit_venn_abers(y, p)
    lo, hi = K.venn_abers(0.3, big)
    assert lo <= 0.3 + 0.08 and hi >= 0.3 - 0.08 and 0 <= lo <= hi <= 1
    small = K.fit_venn_abers(y[:150], p[:150])
    lo2, hi2 = K.venn_abers(0.3, small)
    assert (hi2 - lo2) >= (hi - lo)


def test_shift_check_reports_each_group():
    y, p = _data(900)
    g = np.array(["a", "b", "c"] * 300)
    assert set(K.coverage_under_shift(y, p, g)) == {"a", "b", "c"}
