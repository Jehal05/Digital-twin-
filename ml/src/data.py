"""Dataset loading and cleaning. Cleaning here is label-agnostic and uses no statistics from the data
(imputation happens inside the model pipeline so it is fit on training rows only)."""
from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pandas as pd

PIMA_COLUMNS = ["pregnancies", "glucose", "blood_pressure", "skin_thickness", "insulin", "bmi",
                "diabetes_pedigree", "age", "outcome"]
# In the Pima data a value of 0 in these columns is physiologically impossible and means "not recorded".
PIMA_ZERO_MEANS_MISSING = ["glucose", "blood_pressure", "skin_thickness", "insulin", "bmi"]

CLEVELAND_COLUMNS = ["age", "sex", "cp", "trestbps", "chol", "fbs", "restecg", "thalach", "exang", "oldpeak",
                     "slope", "ca", "thal", "num"]


def sha256_of(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_pima(path: Path) -> tuple[pd.DataFrame, pd.Series, dict]:
    path = Path(path)
    df = pd.read_csv(path, header=None, names=PIMA_COLUMNS)
    if df.shape[1] != 9 or df["outcome"].isin([0, 1]).mean() < 1.0:
        raise ValueError("pima.csv does not look like the 9-column Pima file with a 0/1 outcome in the last column.")
    zero_counts = {c: int((df[c] == 0).sum()) for c in PIMA_ZERO_MEANS_MISSING}
    df[PIMA_ZERO_MEANS_MISSING] = df[PIMA_ZERO_MEANS_MISSING].replace(0, np.nan)
    y = df.pop("outcome").astype(int)
    info = {
        "file": path.name, "sha256": sha256_of(path), "rows": int(len(df)), "positives": int(y.sum()),
        "positive_rate": round(float(y.mean()), 4), "zeros_treated_as_missing": zero_counts,
        "duplicate_rows": int(df.duplicated().sum()),
    }
    return df, y, info


def load_cleveland(path: Path) -> tuple[pd.DataFrame, pd.Series, dict]:
    """Load the ORIGINAL UCI file processed.cleveland.data (14 columns, no header, '?' = missing)."""
    path = Path(path)
    first_line = path.read_text(errors="ignore").splitlines()[0].strip().lower()
    if first_line.startswith("age") or "target" in first_line:
        raise ValueError(
            "This looks like a header-row CSV from Kaggle or a mirror. Those versions recode columns and often flip the "
            "target. Use the original 'processed.cleveland.data' from the UCI repository (heart-disease folder)."
        )
    df = pd.read_csv(path, header=None, names=CLEVELAND_COLUMNS, na_values="?")
    if df.shape[1] != 14 or not df["cp"].dropna().between(1, 4).all():
        raise ValueError("processed.cleveland.data must have 14 columns with chest-pain type (cp) coded 1-4.")
    y = (df.pop("num") > 0).astype(int)  # 0 = no disease; 1-4 = disease present
    info = {
        "file": path.name, "sha256": sha256_of(path), "rows": int(len(df)), "positives": int(y.sum()),
        "positive_rate": round(float(y.mean()), 4),
        "missing_values": {c: int(n) for c, n in df.isna().sum().items() if n},
        "duplicate_rows": int(df.duplicated().sum()),
    }
    return df, y, info


HEART_SITES = ("cleveland", "hungarian", "switzerland", "va")
HEART_SITE_ROWS = {"cleveland": 303, "hungarian": 294, "switzerland": 123, "va": 200}   # published sizes of the four UCI files


def load_uci_heart_combined(directory: Path) -> tuple[pd.DataFrame, pd.Series, pd.Series, dict]:
    """The four original UCI heart-disease files (Cleveland, Hungarian, Swiss, VA Long Beach), 920 patients.

    Returns X, y, site (which hospital each row came from) and an info dict. Cholesterol 0 (and one resting BP of 0) is how
    these files encode "not measured" and is treated as missing. The site is kept ONLY for validation (leave-one-hospital-out);
    it is never a model input.
    """
    directory = Path(directory)
    frames, per_site = [], {}
    for site in HEART_SITES:
        path = directory / f"processed.{site}.data"
        first = path.read_text(errors="ignore").splitlines()[0].strip()
        skip = 1 if first.startswith("(age)") else 0   # one mirror adds a header line to the Hungarian file
        df = pd.read_csv(path, header=None, names=CLEVELAND_COLUMNS, na_values="?", skiprows=skip)
        if len(df) != HEART_SITE_ROWS[site] or not df["cp"].dropna().between(1, 4).all():
            raise ValueError(f"{path.name}: expected {HEART_SITE_ROWS[site]} rows with chest-pain type coded 1-4, got {len(df)} rows.")
        df["site"] = site
        frames.append(df)
        per_site[site] = {"file": path.name, "sha256": sha256_of(path), "rows": int(len(df)),
                          "positive_rate": round(float((df["num"] > 0).mean()), 4)}
    all_ = pd.concat(frames, ignore_index=True)
    zero_chol, zero_bp = int((all_["chol"] == 0).sum()), int((all_["trestbps"] == 0).sum())
    all_["chol"] = all_["chol"].replace(0, np.nan)
    all_["trestbps"] = all_["trestbps"].replace(0, np.nan)
    y = (all_.pop("num") > 0).astype(int)
    site = all_.pop("site")
    info = {"file": "uci_heart/processed.{cleveland,hungarian,switzerland,va}.data", "sha256": hashlib.sha256(
                "".join(v["sha256"] for v in per_site.values()).encode()).hexdigest(),
            "rows": int(len(all_)), "positives": int(y.sum()), "positive_rate": round(float(y.mean()), 4), "sites": per_site,
            "zero_cholesterol_treated_as_missing": zero_chol, "zero_resting_bp_treated_as_missing": zero_bp,
            "missing_values": {c: int(n) for c, n in all_.isna().sum().items() if n}}
    return all_, y, site, info


BRFSS_FEATURES = ["HighBP", "HighChol", "BMI", "Smoker", "Stroke", "HeartDiseaseorAttack", "PhysActivity", "Fruits", "Veggies",
                  "HvyAlcoholConsump", "GenHlth", "MentHlth", "PhysHlth", "DiffWalk", "Sex", "Age"]


def load_brfss(path: Path) -> tuple[pd.DataFrame, pd.Series, dict]:
    """CDC BRFSS 2015 'diabetes health indicators' (253,680 survey respondents). Outcome: self-reported diagnosed diabetes.

    Income, education, insurance and doctor-cost columns are deliberately NOT used: they are socio-economic proxies, and a
    health estimate that changes with income would be unfair and not actionable.
    """
    path = Path(path)
    df = pd.read_csv(path)
    if "Diabetes_012" not in df.columns or len(df) < 200_000:
        raise ValueError("Expected diabetes_012_health_indicators_BRFSS2015.csv (253,680 rows, column Diabetes_012).")
    y = (df["Diabetes_012"] == 2).astype(int)          # 2 = diabetes; 0 = none; 1 = prediabetes (counted as not diabetic)
    X = df[BRFSS_FEATURES].astype(float)
    keep = X["BMI"].between(12, 70)
    info = {"file": path.name, "sha256": sha256_of(path), "rows_in_file": int(len(df)), "rows": int(keep.sum()),
            "dropped_for_implausible_bmi": int((~keep).sum()), "positives": int(y[keep].sum()),
            "positive_rate": round(float(y[keep].mean()), 4), "prediabetes_share": round(float((df["Diabetes_012"] == 1).mean()), 4),
            "identical_rows": int(X[keep].duplicated().sum())}
    return X[keep].reset_index(drop=True), y[keep].reset_index(drop=True), info


LOADERS = {"diabetes": load_pima, "heart_disease": load_cleveland}
