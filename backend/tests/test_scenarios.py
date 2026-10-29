import uuid

from app.services.goal_planner import REALISTIC


def make(user, baseline, **kw):
    body = {"name": "Lower BMI", "condition": "diabetes", "baseline_prediction_id": baseline["id"], "changed_inputs": {"bmi": 27.0}}
    body.update(kw)
    return user.post("/scenarios", body)


def test_scenario_reruns_model_and_never_changes_baseline(user, baseline):
    r = make(user, baseline)
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["content_kind"] == "hypothetical" and s["baseline"]["score"] == baseline["score"]
    assert s["scenario"]["input_snapshot"]["bmi"] == 27.0 and s["baseline"]["input_snapshot"]["bmi"] == 31.0
    assert s["delta_pp"] == round((s["scenario"]["score"] - s["baseline"]["score"]) * 100, 2)
    assert "does not prove" in s["note"]
    assert user.get(f"/predictions/{baseline['id']}").json()["input_snapshot"]["bmi"] == 31.0


def test_only_editable_model_inputs_may_change(user, baseline):
    for bad in ({"age": 25}, {"smoker": 1}, {"pregnancies": 0}):
        r = make(user, baseline, changed_inputs=bad)
        assert r.status_code == 422 and list(bad)[0] in r.json()["error"]["fields"], bad
    assert make(user, baseline, changed_inputs={"bmi": 500}).status_code == 422  # model range still enforced


def test_scenario_runs_are_excluded_from_prediction_history(user, baseline):
    make(user, baseline)
    make(user, baseline, name="Lower glucose", changed_inputs={"glucose": 110})
    assert [h["id"] for h in user.get("/predictions/history").json()["items"]] == [baseline["id"]]
    assert len(user.get("/scenarios").json()["items"]) == 2


def test_compare_several_scenarios_and_delete_one(user, baseline):
    a = make(user, baseline, name="A").json()
    b = make(user, baseline, name="B", changed_inputs={"bmi": 28.0}).json()
    assert {x["name"] for x in user.get("/scenarios", params={"condition": "diabetes"}).json()["items"]} == {"A", "B"}
    assert user.delete(f"/scenarios/{a['id']}").status_code == 204
    assert user.get(f"/scenarios/{a['id']}").status_code == 404
    assert user.get(f"/scenarios/{b['id']}").status_code == 200
    assert user.get(f"/predictions/{baseline['id']}").status_code == 200, "baseline survives scenario deletion"


def test_a_hypothetical_prediction_cannot_be_used_as_a_baseline(user, baseline):
    s = make(user, baseline).json()
    assert make(user, s["scenario"]).status_code == 404


def test_goal_plan_finds_changes_with_the_real_model_and_saves_a_scenario(user, baseline):
    target = round(baseline["score"] - 0.10, 2)
    r = user.post("/scenarios/goal-plan", {"condition": "diabetes", "baseline_prediction_id": baseline["id"], "target_score": target})
    assert r.status_code == 200, r.text
    g = r.json()
    assert g["feasible"] and g["changes"] and g["content_kind"] == "hypothetical" and "not medical advice" in g["note"]
    assert g["estimated_score"] <= target
    assert g["scenario"]["scenario"]["score"] == g["estimated_score"] and g["scenario"]["kind"] == "goal_plan"
    for feature, new in g["changes"].items():
        cap = g["constraints"][feature]
        assert new < baseline["input_snapshot"][feature] and new >= cap["floor"]
        assert baseline["input_snapshot"][feature] - new <= cap["max_decrease"] + 1e-9


def test_goal_plan_prefers_the_smallest_change(user, baseline):
    gentle = user.post("/scenarios/goal-plan", {"condition": "diabetes", "baseline_prediction_id": baseline["id"],
                                                 "target_score": round(baseline["score"] - 0.03, 2)}).json()
    bigger = user.post("/scenarios/goal-plan", {"condition": "diabetes", "baseline_prediction_id": baseline["id"],
                                                 "target_score": round(baseline["score"] - 0.15, 2)}).json()
    total = lambda g: sum((baseline["input_snapshot"][f] - v) / g["constraints"][f]["max_decrease"] for f, v in g["changes"].items())  # noqa: E731
    assert total(gentle) < total(bigger)


def test_goal_plan_respects_locked_inputs(user, baseline):
    g = user.post("/scenarios/goal-plan", {"condition": "diabetes", "baseline_prediction_id": baseline["id"],
                                            "target_score": round(baseline["score"] - 0.05, 2), "locked_inputs": ["glucose"]}).json()
    assert "glucose" not in g["changes"] and "glucose" in g["locked_inputs"]


def test_goal_plan_says_so_when_the_target_is_unreachable_and_saves_nothing(user, baseline):
    r = user.post("/scenarios/goal-plan", {"condition": "diabetes", "baseline_prediction_id": baseline["id"], "target_score": 0.02})
    g = r.json()
    assert r.status_code == 200 and g["feasible"] is False and "nothing was saved" in g["message"]
    assert user.get("/scenarios").json()["items"] == []


def test_goal_plan_rejects_a_target_above_the_baseline(user, baseline):
    r = user.post("/scenarios/goal-plan", {"condition": "diabetes", "baseline_prediction_id": baseline["id"], "target_score": 0.98})
    assert r.status_code == 422


def test_planner_limits_only_reference_editable_features(client):
    model = client.app.state.registry.get("diabetes")
    assert set(REALISTIC["diabetes"]) <= set(model.editable_features())


def test_unknown_baseline_is_404(user):
    r = user.post("/scenarios", {"name": "x", "condition": "diabetes", "baseline_prediction_id": str(uuid.uuid4()),
                                 "changed_inputs": {"bmi": 25}})
    assert r.status_code == 404


def test_heart_what_if_and_goal_plan_use_the_real_heart_model(user):
    heart = {"age": 58, "sex": 1, "cp": 4, "trestbps": 160, "chol": 300, "fbs": 0, "restecg": 0,
             "thalach": 130, "exang": 0, "oldpeak": 1.0}
    base = user.post("/predictions/heart-disease", {"features": heart}).json()
    r = user.post("/scenarios", {"name": "lower bp", "condition": "heart_disease", "baseline_prediction_id": base["id"],
                                 "changed_inputs": {"trestbps": 120}})
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["content_kind"] == "hypothetical" and s["scenario"]["input_snapshot"]["trestbps"] == 120.0
    assert s["scenario"]["input_snapshot"]["age"] == 58.0 and s["scenario"]["score"] != base["score"]
    # fixed (non-editable) inputs cannot be simulated
    bad = user.post("/scenarios", {"name": "x", "condition": "heart_disease", "baseline_prediction_id": base["id"],
                                   "changed_inputs": {"sex": 0}})
    assert bad.status_code == 422
    g = user.post("/scenarios/goal-plan", {"condition": "heart_disease", "baseline_prediction_id": base["id"],
                                           "target_score": max(0.05, base["score"] - 0.05)})
    assert g.status_code in (200, 201), g.text
    assert set(g.json()["changes"]) <= {"trestbps", "chol"}
