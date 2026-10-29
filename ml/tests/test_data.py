import numpy as np
import pytest

from src import config as C
from src.data import load_cleveland, load_pima

pytestmark = pytest.mark.skipif(not (C.RAW_DIR / "pima.csv").exists(), reason="pima.csv not present")


def test_pima_shape_and_known_counts():
    X, y, info = load_pima(C.RAW_DIR / "pima.csv")
    assert X.shape == (768, 8) and int(y.sum()) == 268
    assert info["zeros_treated_as_missing"] == {"glucose": 5, "blood_pressure": 35, "skin_thickness": 227, "insulin": 374, "bmi": 11}


def test_pima_zeros_become_missing_not_zero():
    X, _, _ = load_pima(C.RAW_DIR / "pima.csv")
    assert X["glucose"].isna().sum() == 5 and (X["glucose"] == 0).sum() == 0
    assert (X["pregnancies"] == 0).sum() > 0, "zero pregnancies is a valid value and must be kept"


def test_cleveland_rejects_kaggle_style_file(tmp_path):
    f = tmp_path / "heart.csv"
    f.write_text("age,sex,cp,trestbps,chol,fbs,restecg,thalach,exang,oldpeak,slope,ca,thal,target\n63,1,3,145,233,1,0,150,0,2.3,0,0,1,1\n")
    with pytest.raises(ValueError, match="Kaggle"):
        load_cleveland(f)


def test_cleveland_binarises_label_and_reads_missing(tmp_path):
    f = tmp_path / "processed.cleveland.data"
    f.write_text("63,1,1,145,233,1,2,150,0,2.3,3,0,6,0\n67,1,4,160,286,0,2,108,1,1.5,2,3,3,2\n41,0,2,130,204,0,2,172,0,1.4,1,?,3,0\n")
    X, y, _ = load_cleveland(f)
    assert y.tolist() == [0, 1, 0] and np.isnan(X["ca"].iloc[2])
