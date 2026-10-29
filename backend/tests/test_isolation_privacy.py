import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.models import tables as T
from tests.conftest import PASSWORD, User

NOW = datetime.now(timezone.utc)


def seed(u):
    u.put("/profile", {"sex": "female", "height_cm": 170, "date_of_birth": "1988-05-01"})
    m = u.post("/measurements", {"measurement_type": "glucose_mgdl", "value": 99, "unit": "mg/dL",
                                 "recorded_at": (NOW - timedelta(hours=3)).isoformat()}).json()
    p = u.post("/predictions/diabetes", {"features": {"pregnancies": 1, "glucose": 130, "blood_pressure": 70, "bmi": 29, "age": 35}}).json()
    s = u.post("/scenarios", {"name": "s", "condition": "diabetes", "baseline_prediction_id": p["id"], "changed_inputs": {"bmi": 25}}).json()
    return m, p, s


def test_users_cannot_see_or_use_each_others_records(user, other):
    m, p, s = seed(user)
    # every direct lookup of someone else's id looks exactly like "does not exist"
    assert other.get(f"/predictions/{p['id']}").status_code == 404
    assert other.get(f"/predictions/{p['id']}/trust").status_code == 404
    assert other.get(f"/scenarios/{s['id']}").status_code == 404
    assert other.delete(f"/scenarios/{s['id']}").status_code == 404
    assert other.post(f"/measurements/{m['id']}/resolve", {"action": "confirm"}).status_code == 404
    r = other.post("/scenarios", {"name": "steal", "condition": "diabetes", "baseline_prediction_id": p["id"], "changed_inputs": {"bmi": 20}})
    assert r.status_code == 404
    r = other.post("/scenarios/goal-plan", {"condition": "diabetes", "baseline_prediction_id": p["id"], "target_score": 0.1})
    assert r.status_code == 404
    # listings are empty for the other user
    assert other.get("/measurements").json()["items"] == [] and other.get("/predictions/history").json()["items"] == []
    assert other.get("/scenarios").json()["items"] == []
    dash = other.get("/dashboard").json()
    assert dash["latest_measurements"] == {} and dash["latest_predictions"]["diabetes"] is None and dash["scenario_count"] == 0
    # and the owner still sees everything
    assert user.get(f"/predictions/{p['id']}").status_code == 200


def test_user_id_in_a_request_body_is_ignored_or_rejected(user, other):
    r = other.post("/measurements", {"measurement_type": "steps", "value": 10, "unit": "count",
                                     "recorded_at": (NOW - timedelta(hours=1)).isoformat(), "user_id": user.id})
    assert r.status_code == 422  # unknown fields are forbidden, so an owner cannot be spoofed


def test_dashboard_summarises_the_users_own_data(user):
    seed(user)
    d = user.get("/dashboard").json()
    assert d["latest_measurements"]["glucose_mgdl"]["content_kind"] == "measured"
    assert d["latest_predictions"]["diabetes"]["content_kind"] == "ai_estimate" and d["latest_predictions"]["heart_disease"] is None
    assert d["scenario_count"] == 1 and len(d["trend_series"]["glucose_mgdl"]) == 1 and d["profile"]["age"] is not None


def test_export_contains_only_the_callers_data(user, other):
    seed(user)
    seed(other)
    r = user.get("/privacy/export")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data = json.loads(r.text)
    assert data["account"]["email"] == user.email and other.email not in r.text
    assert len(data["measurements"]) == 1 and len(data["predictions"]) == 2 and len(data["scenarios"]) == 1
    assert "password" not in r.text.lower() and "token" not in r.text.lower()


def test_delete_account_requires_password_then_removes_everything(client, user, other):
    seed(user)
    seed(other)
    assert user.delete("/privacy/account", json={"password": "wrong-password-1"}).status_code == 403
    assert user.get("/profile").status_code == 200
    assert user.delete("/privacy/account", json={"password": PASSWORD}).status_code == 202
    assert user.get("/profile").status_code == 401, "old access token must stop working"
    assert client.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD}).status_code == 401
    uid = __import__("uuid").UUID(user.id)
    with client.app.state.sessionmaker() as db:
        for model in (T.HealthMeasurement, T.Prediction, T.SimulationScenario, T.Consent, T.RefreshToken, T.HealthProfile, T.AuditEvent):
            n = db.scalar(select(func.count()).select_from(model).where(model.user_id == uid))
            assert n == 0, f"{model.__tablename__} still has rows for the deleted user"
        assert db.get(T.User, uid) is None
    assert len(other.get("/measurements").json()["items"]) == 1, "other users are untouched"


def test_audit_log_never_stores_health_values_or_secrets(client, user):
    seed(user)
    with client.app.state.sessionmaker() as db:
        details = json.dumps([e.detail for e in db.scalars(select(T.AuditEvent))])
        types = {e.event_type for e in db.scalars(select(T.AuditEvent))}
    assert {"register", "prediction", "scenario_created"} <= types
    assert "130" not in details and PASSWORD not in details


def test_profile_and_preferences_roundtrip(user):
    assert user.put("/profile", {"sex": "male", "height_cm": 180, "date_of_birth": "1990-01-02"}).json()["sex"] == "male"
    assert user.put("/profile", {"height_cm": 10}).status_code == 422
    assert user.put("/profile", {"date_of_birth": "2999-01-01"}).status_code == 422
    assert user.put("/preferences", {"locale": "hi", "theme": "dark"}).json() == {"locale": "hi", "theme": "dark", "reduced_motion": False}
    assert user.get("/preferences").json()["locale"] == "hi"
    assert user.put("/preferences", {"locale": "fr"}).status_code == 422


def test_unexpected_errors_do_not_leak_details(client, user, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret internal detail glucose=999")
    monkeypatch.setattr(client.app.state.registry.get("diabetes"), "predict", boom)
    from fastapi.testclient import TestClient  # the default client re-raises server errors; a real caller only sees the response
    real_caller = TestClient(client.app, raise_server_exceptions=False)
    r = real_caller.post("/api/v1/predictions/diabetes", headers=user.h,
                         json={"features": {"pregnancies": 1, "glucose": 130, "blood_pressure": 70, "bmi": 29, "age": 35}})
    assert r.status_code == 500 and "secret" not in r.text and r.json()["error"]["code"] == "internal_error"
