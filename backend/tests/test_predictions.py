from datetime import date, datetime, timedelta, timezone

import pytest

from tests.conftest import PROFILE

NOW = datetime.now(timezone.utc)


def test_prediction_comes_from_the_real_model_with_labels(user, baseline):
    b = baseline
    assert 0 < b["score"] < 1 and b["risk_band"] in {"low", "moderate", "high"}
    assert b["content_kind"] == "ai_estimate" and b["model"]["version"] == "1.0.0"
    assert any("not a diagnosis" in s for s in b["limitations"])
    assert b["trust"]["uncertainty_range"]["low"] <= b["score"] <= b["trust"]["uncertainty_range"]["high"]
    assert b["explanation"]["top_drivers"][0]["feature"] == "glucose"
    assert b["input_snapshot"]["glucose"] == 140.0


def test_same_inputs_give_the_same_score(user):
    a = user.post("/predictions/diabetes", {"features": PROFILE}).json()["score"]
    b = user.post("/predictions/diabetes", {"features": PROFILE}).json()["score"]
    assert a == b


def test_invalid_and_unknown_inputs_are_rejected_not_clamped(user):
    r = user.post("/predictions/diabetes", {"features": {**PROFILE, "glucose": 5}})
    assert r.status_code == 422 and "glucose" in r.json()["error"]["fields"]
    r = user.post("/predictions/diabetes", {"features": {**PROFILE, "smoker": 1}})
    assert r.status_code == 422 and "smoker" in r.json()["error"]["fields"]


def test_missing_inputs_are_listed_never_filled(user):
    r = user.post("/predictions/diabetes", {"features": {"glucose": 120}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "missing_inputs"
    assert set(r.json()["error"]["fields"]) == {"pregnancies", "blood_pressure", "bmi", "age"}


def test_use_latest_assembles_inputs_from_profile_and_measurements_with_sources(user):
    dob = date.today().replace(year=date.today().year - 40) - timedelta(days=30)
    user.put("/profile", {"date_of_birth": dob.isoformat(), "sex": "female", "height_cm": 165})
    when = (NOW - timedelta(days=2)).isoformat()
    for t, v, u in [("glucose_2h_mgdl", 6.7, "mmol/L"), ("bp_diastolic", 80, "mmHg"), ("weight_kg", 82, "kg")]:
        assert user.post("/measurements", {"measurement_type": t, "value": v, "unit": u, "recorded_at": when}).status_code == 201
    r = user.post("/predictions/diabetes", {"use_latest": True, "features": {"pregnancies": 1}})
    assert r.status_code == 201, r.text
    snap, src = r.json()["input_snapshot"], r.json()["input_sources"]
    assert snap["age"] == 40 and snap["glucose"] == pytest.approx(120.707, abs=0.01) and snap["bmi"] == 30.1
    assert src["bmi"].startswith("computed from weight") and src["pregnancies"] == "provided in request"
    assert src["age"] == "profile date of birth"


def test_explicit_values_override_measurements(user):
    user.post("/measurements", {"measurement_type": "glucose_2h_mgdl", "value": 90, "unit": "mg/dL",
                                "recorded_at": (NOW - timedelta(hours=2)).isoformat()})
    r = user.post("/predictions/diabetes", {"use_latest": True, "features": {**PROFILE, "glucose": 150}})
    assert r.json()["input_snapshot"]["glucose"] == 150.0


def test_heart_model_unavailable_gives_clear_503_when_not_loaded(client, user):
    client.app.state.registry.models.pop("heart_disease", None)
    r = user.post("/predictions/heart-disease", {"features": {"age": 50}})
    assert r.status_code == 503 and r.json()["error"]["code"] == "model_unavailable"


HEART = {"age": 58, "sex": 1, "cp": 4, "trestbps": 140, "chol": 240, "fbs": 0, "restecg": 0,
         "thalach": 120, "exang": 1, "oldpeak": 2.0}


def test_heart_estimate_comes_from_the_trained_model_and_is_labelled(client, user):
    assert "heart_disease" in client.app.state.registry.models
    r = user.post("/predictions/heart-disease", {"features": HEART})
    assert r.status_code == 201, r.text
    body = r.json()
    assert 0 <= body["score"] <= 1 and body["condition"] == "heart_disease"
    low = user.post("/predictions/heart-disease", {"features": {**HEART, "age": 35, "sex": 0, "cp": 2, "exang": 0, "oldpeak": 0.0, "thalach": 180}}).json()
    assert low["score"] < body["score"]


def test_heart_rejects_out_of_range_values(user):
    r = user.post("/predictions/heart-disease", {"features": {**HEART, "chol": 9000}})
    assert r.status_code == 422


def test_history_lists_real_estimates_and_one_can_be_fetched(user, baseline):
    hist = user.get("/predictions/history").json()["items"]
    assert [h["id"] for h in hist] == [baseline["id"]]
    assert user.get(f"/predictions/{baseline['id']}").json()["score"] == baseline["score"]
    assert user.get(f"/predictions/{baseline['id']}/trust").json()["trust"]["model_agreement"]["level"] in {"high", "medium", "low"}


def test_model_versions_are_synced_to_the_database(client):
    from sqlalchemy import select

    from app.models.tables import ModelVersion
    with client.app.state.sessionmaker() as db:
        rows = db.scalars(select(ModelVersion)).all()
    assert sorted((r.condition, r.version, r.is_active) for r in rows) == [("diabetes", "1.0.0", True), ("diabetes_survey", "1.0.0", True), ("heart_disease", "2.0.0", True)]
    assert all("sha256" in r.dataset_ref and r.metrics["primary_algorithm"] == "logistic_regression" for r in rows)


def test_evaluation_endpoint_serves_metrics_without_internal_split_indices(user):
    r = user.get("/models/evaluation").json()
    assert {i["condition"] for i in r["items"]} == {"diabetes", "diabetes_survey", "heart_disease"} and r["unavailable"] == []
    for item in r["items"]:
        assert "test_index" not in item["metrics"]["split"] and "Limitations" in item["model_card_markdown"]


def test_cohort_percentile_is_labelled_as_cohort_only(user):
    r = user.get("/cohort/percentile", params={"condition": "diabetes", "feature": "glucose", "value": 140}).json()
    assert 50 < r["percentile"] < 95 and r["content_kind"] == "cohort_comparison" and "study" in r["note"]
    far = user.get("/cohort/percentile", params={"condition": "diabetes", "feature": "glucose", "value": 399}).json()
    assert far["percentile"] == 100 and far["outside_cohort_range"] is True
    assert user.get("/cohort/percentile", params={"condition": "diabetes", "feature": "bogus", "value": 1}).status_code == 422


def test_a_fasting_glucose_is_never_used_as_the_two_hour_value(user):
    when = (NOW - timedelta(days=1)).isoformat()
    assert user.post("/measurements", {"measurement_type": "glucose_mgdl", "value": 95, "unit": "mg/dL", "recorded_at": when}).status_code == 201
    r = user.post("/predictions/diabetes", {"use_latest": True, "features": {"pregnancies": 1, "blood_pressure": 70, "bmi": 28, "age": 40}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "missing_inputs"
    assert "2-hour" in r.json()["error"]["fields"]["glucose"]


SURVEY = {"high_bp": 1, "high_chol": 1, "bmi": 33, "smoker": 1, "stroke": 0, "heart_disease_or_attack": 0, "physical_activity": 0,
          "fruit_daily": 0, "veg_daily": 1, "heavy_alcohol": 0, "general_health": 4, "mental_health_days": 5, "physical_health_days": 10,
          "difficulty_walking": 1, "sex": 1, "age_band": 10}


def test_survey_model_gives_a_labelled_estimate_and_responds_sensibly(user):
    hi = user.post("/predictions/diabetes-survey", {"features": SURVEY})
    assert hi.status_code == 201, hi.text
    body = hi.json()
    assert body["condition"] == "diabetes_survey" and body["content_kind"] == "ai_estimate" and 0 < body["score"] < 1
    lo = user.post("/predictions/diabetes-survey", {"features": {**SURVEY, "high_bp": 0, "high_chol": 0, "bmi": 22, "general_health": 1,
                                                               "difficulty_walking": 0, "physical_health_days": 0, "age_band": 4}})
    assert lo.json()["score"] < body["score"]
    assert len(body["trust"]["model_agreement"]["models"]) == 4 and body["trust"]["uncertainty_range"]["low"] <= body["score"] <= body["trust"]["uncertainty_range"]["high"]


def test_survey_model_rejects_out_of_range_inputs(user):
    r = user.post("/predictions/diabetes-survey", {"features": {**SURVEY, "age_band": 40}})
    assert r.status_code == 422


def test_survey_goal_planner_only_changes_habits(user):
    p = user.post("/predictions/diabetes-survey", {"features": SURVEY}).json()
    r = user.post("/scenarios/goal-plan", {"condition": "diabetes_survey", "baseline_prediction_id": p["id"], "target_score": round(p["score"] - 0.03, 3)})
    assert r.status_code == 200, r.text
    allowed = {"bmi", "smoker", "physical_activity", "fruit_daily", "veg_daily", "heavy_alcohol"}
    assert set(r.json()["changes"]) <= allowed
