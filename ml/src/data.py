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


LOADERS = {"diabetes": load_pima, "heart_disease": load_cleveland}
