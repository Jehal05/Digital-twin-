import numpy as np
import pandas as pd
import pytest

from src import config as C
from src.data import load_cleveland, load_pima
from src.pipeline import train_condition

PIMA = C.RAW_DIR / "pima.csv"


def write_synthetic_cleveland(path, n=303, seed=0):
    """SYNTHETIC data in the raw UCI file format, used ONLY to test the heart code path.
    Never used for real artifacts or reported metrics."""
    r = np.random.default_rng(seed)
    age = r.integers(29, 78, n)
    sex = r.integers(0, 2, n)
    cp = r.integers(1, 5, n)
    trestbps = r.normal(131, 17, n).round()
    chol = r.normal(246, 50, n).round()
    thalach = (200 - age + r.normal(0, 18, n)).round()
    exang = r.integers(0, 2, n)
    oldpeak = np.clip(r.gamma(1.2, 0.9, n), 0, 6).round(1)
    logit = 0.04 * (age - 55) + 0.8 * (cp == 4) + 0.9 * exang + 0.5 * oldpeak - 0.03 * (thalach - 150) - 0.3
    num = (r.random(n) < 1 / (1 + np.exp(-logit))).astype(int) * r.integers(1, 5, n)
    df = pd.DataFrame({"age": age, "sex": sex, "cp": cp, "trestbps": trestbps, "chol": chol,
                       "fbs": r.integers(0, 2, n), "restecg": r.integers(0, 3, n), "thalach": thalach, "exang": exang,
                       "oldpeak": oldpeak, "slope": r.integers(1, 4, n), "ca": r.integers(0, 4, n).astype(float),
                       "thal": r.choice([3.0, 6.0, 7.0], n), "num": num})
    df.loc[r.choice(n, 4, replace=False), "ca"] = np.nan
    df.loc[r.choice(n, 2, replace=False), "thal"] = np.nan
    df.to_csv(path, header=False, index=False, na_rep="?")


@pytest.fixture(scope="session")
def pima_artifacts(tmp_path_factory):
    if not PIMA.exists():
        pytest.skip("pima.csv not present")
    out = tmp_path_factory.mktemp("art")
    X, y, info = load_pima(PIMA)
    res = train_condition(C.DIABETES, X, y, info, out, fast=True)
    return out, res, (X, y)


@pytest.fixture(scope="session")
def heart_artifacts(tmp_path_factory):
    d = tmp_path_factory.mktemp("heart")
    f = d / "processed.cleveland.data"
    write_synthetic_cleveland(f)
    X, y, info = load_cleveland(f)
    out = tmp_path_factory.mktemp("art_heart")
    res = train_condition(C.HEART, X, y, info, out, fast=True)
    return out, res, (X, y)
