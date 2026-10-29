import pytest

from src.inference import HealthTwinModel, InputValidationError

PROFILE = {"pregnancies": 2, "glucose": 120, "blood_pressure": 70, "bmi": 28.0, "age": 35}


@pytest.fixture(scope="module")
def model(pima_artifacts):
    out, _, _ = pima_artifacts
    return HealthTwinModel.load("diabetes", artifact_dir=out)


def test_prediction_shape_and_labels(model):
    r = model.predict(PROFILE)
    assert 0.0 <= r["score"] <= 1.0 and r["risk_band"] in {"low", "moderate", "high"}
    assert r["content_kind"] == "ai_estimate" and r["model"]["version"] == "1.0.0"
    assert any("not a diagnosis" in s for s in r["limitations"])
    assert r["input_snapshot"]["glucose"] == 120.0


def test_prediction_is_deterministic(model):
    assert model.predict(PROFILE)["score"] == model.predict(PROFILE)["score"]


@pytest.mark.parametrize("field", list(PROFILE))
def test_missing_input_is_rejected_never_filled(model, field):
    bad = {k: v for k, v in PROFILE.items() if k != field}
    with pytest.raises(InputValidationError) as e:
        model.predict(bad)
    assert e.value.fields == {field: "required"}


@pytest.mark.parametrize("field,value", [("glucose", 5), ("glucose", 900), ("bmi", -1), ("age", 12),
                                         ("pregnancies", 2.5), ("glucose", float("nan")), ("bmi", "28"), ("age", True)])
def test_invalid_values_are_rejected(model, field, value):
    with pytest.raises(InputValidationError) as e:
        model.predict({**PROFILE, field: value})
    assert field in e.value.fields


def test_unknown_inputs_are_rejected(model):
    with pytest.raises(InputValidationError) as e:
        model.predict({**PROFILE, "smoker": 1})
    assert "smoker" in e.value.fields


def test_glucose_effect_has_the_expected_direction(model):
    """Sanity check against medical plausibility: higher glucose should not LOWER the estimate."""
    assert model.predict({**PROFILE, "glucose": 190})["score"] > model.predict({**PROFILE, "glucose": 85})["score"]


def test_trust_meter_fields(model):
    t = model.predict(PROFILE)["trust"]
    assert t["uncertainty_range"]["low"] <= t["uncertainty_range"]["high"]
    assert t["model_agreement"]["level"] in {"high", "medium", "low"}
    assert t["out_of_distribution"] == []


def test_out_of_distribution_input_is_flagged_but_still_valid(model):
    t = model.predict({**PROFILE, "bmi": 69.0})["trust"]
    assert [o["feature"] for o in t["out_of_distribution"]] == ["bmi"]


def test_shap_explanation_identifies_glucose_for_high_glucose_profile(model):
    drivers = model.predict({**PROFILE, "glucose": 190})["explanation"]["top_drivers"]
    assert drivers[0]["feature"] == "glucose" and drivers[0]["direction"] == "raises"
    assert "not show medical causation" in model.predict(PROFILE)["explanation"]["note"]


def test_shap_effects_roughly_sum_to_prediction_minus_base(model):
    r = model.predict(PROFILE)
    x = r["explanation"]
    total = sum(d["effect"] for d in model._explain(model.validate(PROFILE), top_k=99)["top_drivers"])
    assert abs(x["base_value"] + total - r["score"]) < 0.02


def test_what_if_reruns_model_and_leaves_baseline_untouched(model):
    baseline = dict(PROFILE)
    r = model.compare(baseline, {"bmi": 24.0})
    assert baseline == PROFILE and r["content_kind"] == "hypothetical"
    assert r["baseline"]["score"] == model.predict(PROFILE)["score"]
    assert r["scenario"]["input_snapshot"]["bmi"] == 24.0
    assert r["delta_pp"] == round((r["scenario"]["score"] - r["baseline"]["score"]) * 100, 2)


def test_what_if_refuses_non_editable_inputs(model):
    with pytest.raises(InputValidationError) as e:
        model.compare(PROFILE, {"age": 25})
    assert "not editable" in e.value.fields["age"]


def test_heart_model_loads_validates_and_explains(heart_artifacts):
    out, _, _ = heart_artifacts
    m = HealthTwinModel.load("heart_disease", artifact_dir=out)
    ok = {"age": 54, "sex": 1, "cp": 4, "trestbps": 140, "chol": 240, "fbs": 0, "restecg": 1, "thalach": 150, "exang": 1, "oldpeak": 1.5}
    r = m.predict(ok)
    assert 0 <= r["score"] <= 1 and len(r["explanation"]["top_drivers"]) == 5
    with pytest.raises(InputValidationError):
        m.predict({**ok, "cp": 9})          # categorical outside its allowed set
    with pytest.raises(InputValidationError):
        m.compare(ok, {"thalach": 170})     # not editable
    assert m.compare(ok, {"chol": 190})["scenario"]["input_snapshot"]["chol"] == 190.0
