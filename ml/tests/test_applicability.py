import numpy as np
import pandas as pd

from src import applicability as AP

KINDS = {"a": "continuous", "b": "continuous", "c": "binary", "d": "categorical"}
LABELS = {k: k.upper() for k in KINDS}


def _train(n=2000, seed=0):
    r = np.random.default_rng(seed)
    a = r.normal(50, 10, n)
    return pd.DataFrame({"a": a, "b": a * 0.8 + r.normal(0, 3, n), "c": r.integers(0, 2, n), "d": r.integers(1, 4, n)})


def test_typical_person_is_typical_and_gets_full_confidence():
    X = _train(); a = AP.fit(X, list(KINDS), KINDS)
    r = AP.assess(pd.Series({"a": 50, "b": 40, "c": 1, "d": 2}), a, LABELS, {"a": (0, 200), "b": (0, 200), "c": (0, 1)})
    assert r["level"] == "typical" and r["confidence_multiplier"] == 1.0


def test_unusual_combination_is_caught_even_when_each_value_is_common():
    X = _train(); a = AP.fit(X, list(KINDS), KINDS)
    # a=65 and b=26 are both within the usual range but are almost never seen together (b is about 0.8*a)
    r = AP.assess(pd.Series({"a": 65, "b": 26, "c": 0, "d": 1}), a, LABELS, {"a": (0, 200), "b": (0, 200), "c": (0, 1)})
    assert r["level"] in {"unusual", "outside"} and r["reasons"] and r["confidence_multiplier"] < 1


def test_out_of_range_and_unseen_category_are_outside():
    X = _train(); a = AP.fit(X, list(KINDS), KINDS)
    r = AP.assess(pd.Series({"a": 150, "b": 120, "c": 1, "d": 9}), a, LABELS, {"a": (10, 90), "b": (10, 90), "c": (0, 1)})
    assert r["level"] == "outside" and any("never seen" in x for x in r["reasons"]) and any("outside the range" in x for x in r["reasons"])


def test_missing_inputs_do_not_look_unusual():
    X = _train(); a = AP.fit(X, list(KINDS), KINDS)
    r = AP.assess(pd.Series({"a": np.nan, "b": np.nan, "c": np.nan, "d": np.nan}), a, LABELS, {"a": (0, 200), "b": (0, 200), "c": (0, 1)})
    assert r["level"] == "typical"


def test_about_five_percent_of_training_people_are_flagged():
    X = _train(); a = AP.fit(X, list(KINDS), KINDS)
    lv = [AP.assess(X.iloc[i], a, LABELS, {"a": (0, 200), "b": (0, 200), "c": (0, 1)})["level"] for i in range(0, 2000, 10)]
    assert 0.02 <= np.mean([l != "typical" for l in lv]) <= 0.10
