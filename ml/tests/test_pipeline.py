import json

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

from src import config as C
from src.pipeline import build_preprocessor


def test_artifact_files_exist(pima_artifacts):
    out, _, _ = pima_artifacts
    d = out / "diabetes" / "1.0.0"
    for name in ("model.joblib", "metrics.json", "feature_schema.json", "cohort_stats.json", "manifest.json", "MODEL_CARD.md"):
        assert (d / name).exists(), name
    assert (out / "diabetes" / "ACTIVE").read_text() == "1.0.0"


def test_split_is_disjoint_stratified_and_reproducible(pima_artifacts):
    out, _, (X, y) = pima_artifacts
    m = json.loads((out / "diabetes/1.0.0/metrics.json").read_text())
    test_idx = np.array(m["split"]["test_index"])
    train_idx = np.setdiff1d(np.arange(len(X)), test_idx)
    assert len(set(train_idx) & set(test_idx)) == 0
    assert abs(y.iloc[test_idx].mean() - y.iloc[train_idx].mean()) < 0.03
    _, te = train_test_split(np.arange(len(X)), test_size=C.TEST_SIZE, stratify=y, random_state=C.SEED)
    assert sorted(te) == sorted(test_idx.tolist())


def test_preprocessing_statistics_come_only_from_the_rows_it_is_fit_on():
    train = pd.DataFrame({"glucose": [100.0, 110.0, 120.0, np.nan], "age": [30, 40, 50, 60]})
    holdout = pd.DataFrame({"glucose": [900.0, 900.0], "age": [90, 90]})
    pre = build_preprocessor(["glucose", "age"]).fit(train)
    imputer = pre.named_transformers_["num"].named_steps["impute"]
    assert imputer.statistics_[0] == 110.0, "median must be the TRAIN median, unaffected by held-out values"
    pre.transform(holdout)
    assert imputer.statistics_[0] == 110.0, "transform must not refit"


def test_metrics_are_complete_and_sane(pima_artifacts):
    out, _, _ = pima_artifacts
    m = json.loads((out / "diabetes/1.0.0/metrics.json").read_text())
    for algo, d in m["models"].items():
        t = d["test"]
        assert 0.5 < t["roc_auc"] < 1.0 and 0 < t["brier_score"] < 0.25
        cm = t["at_0.5"]["confusion_matrix"]
        assert sum(cm.values()) == m["split"]["test_rows"]
        assert set(t["roc_curve"]) == {"fpr", "tpr"} and len(t["calibration_curve"]["mean_predicted"]) >= 3
    assert m["primary_algorithm"] in m["models"] and m["models"][m["primary_algorithm"]]["is_primary"]


def test_model_card_states_limitations(pima_artifacts):
    out, _, _ = pima_artifacts
    card = (out / "diabetes/1.0.0/MODEL_CARD.md").read_text()
    for phrase in ("not a diagnosis", "not** been clinically", "Limitations", "False negatives", "Pima Indian"):
        assert phrase in card, phrase


def test_heart_pipeline_runs_end_to_end_on_synthetic_data(heart_artifacts):
    out, res, (X, y) = heart_artifacts
    assert (out / "heart_disease/1.0.0/model.joblib").exists()
    assert res["metrics"]["data"]["rows"] == 303 == len(X)
