"""Parity: the JSON the browser uses must reproduce scikit-learn's probabilities."""
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pytest

from src import export_web as E

ART = Path(__file__).resolve().parents[1] / "artifacts"


@pytest.mark.parametrize("condition", ["diabetes", "heart_disease", "diabetes_survey"])
def test_exported_json_matches_sklearn_to_1e_9(condition):
    version = (ART / condition / "ACTIVE").read_text().strip()
    bundle = joblib.load(ART / condition / version / "model.joblib")
    spec = E.export_bundle(bundle)
    json.loads(json.dumps(spec))                                  # must be JSON-serialisable
    rng = np.random.default_rng(3)
    bg = bundle["background"][bundle["features"]]
    rows = [bg.iloc[i].to_dict() for i in range(0, min(len(bg), 200), 3)]
    ref = np.array([E.reference_predict(spec, r) for r in rows])
    sk = bundle["models"]["logistic_regression"].predict_proba(pd.DataFrame(rows)[bundle["features"]])[:, 1]
    assert np.max(np.abs(ref - sk)) < 1e-9


def test_non_linear_primary_models_are_refused():
    with pytest.raises(ValueError):
        E.export_bundle({"primary": "random_forest", "condition": "x"})
