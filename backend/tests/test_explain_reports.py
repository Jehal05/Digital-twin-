import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import tables as T
from tests.conftest import PASSWORD


class FakeProvider:
    def __init__(self, text):
        self.text, self.calls = text, []

    def complete(self, system, facts, question):
        self.calls.append((facts, question))
        return self.text


def consent(u, granted=True):
    assert u.post("/privacy/consents", {"consent_type": "ai_explainer", "granted": granted}).status_code == 201


# ---- explainer -------------------------------------------------------------------------------------------------

def test_template_answers_only_use_stored_numbers(user, baseline):
    for topic in ("summary", "why", "uncertainty", "what_can_change", "about_model"):
        r = user.post("/explain", {"prediction_id": baseline["id"], "topic": topic})
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["source"] == "template" and b["cited_prediction_id"] == baseline["id"] and "not a diagnosis" in b["disclaimer"].lower()
    s = user.post("/explain", {"prediction_id": baseline["id"], "topic": "summary"}).json()["answer"]
    assert f"{baseline['score'] * 100:.1f}%" in s.replace(".0%", ".0%")
    why = user.post("/explain", {"prediction_id": baseline["id"], "topic": "why"}).json()["answer"]
    assert "glucose" in why.lower() and "do not show what causes" in why


def test_cannot_explain_someone_elses_prediction(other, baseline):
    assert other.post("/explain", {"prediction_id": baseline["id"], "topic": "summary"}).status_code == 404


def test_free_text_is_refused_without_a_provider_and_lists_what_it_can_do(user, baseline):
    r = user.post("/explain", {"prediction_id": baseline["id"], "question": "am I going to get diabetes?"}).json()
    assert r["refused"] is True and "summary" in r["answer"] and r["source"] == "template"


def test_llm_answer_needs_consent_and_is_checked_against_the_facts(client, user, baseline):
    ok = FakeProvider(f"The model puts this at {baseline['score'] * 100:.1f}%, an experimental estimate.")
    client.app.state.explainer_provider = ok
    q = {"prediction_id": baseline["id"], "question": "explain this simply"}
    assert user.post("/explain", q).json()["source"] == "template" and ok.calls == [], "no consent, no provider call"
    consent(user)
    r = user.post("/explain", q).json()
    assert r["source"] == "llm" and ok.calls
    facts = ok.calls[0][0]
    assert user.get("/profile").json()["email"] not in str(facts) and "user" not in set(facts) and facts["inputs"]["glucose"] == 140.0
    consent(user, False)
    assert user.post("/explain", q).json()["source"] == "template", "withdrawing consent takes effect immediately"


def test_a_reply_with_an_invented_number_is_discarded(client, user, baseline):
    consent(user)
    client.app.state.explainer_provider = FakeProvider("Your risk is 87.3% and will double in 5 years.")
    r = user.post("/explain", {"prediction_id": baseline["id"], "question": "what will happen?"}).json()
    assert r["source"] == "template" and "87.3" not in r["answer"]


def test_urgent_symptoms_are_never_sent_to_a_model(client, user, baseline):
    consent(user)
    p = FakeProvider("anything")
    client.app.state.explainer_provider = p
    r = user.post("/explain", {"prediction_id": baseline["id"], "question": "I have chest pain, is it my score?"}).json()
    assert r["refused"] is True and r["source"] == "safety" and "emergency" in r["answer"] and p.calls == []


def test_a_provider_that_crashes_falls_back_to_the_template(client, user, baseline):
    class Boom:
        def complete(self, *a):
            raise RuntimeError("network down with secret key")
    consent(user)
    client.app.state.explainer_provider = Boom()
    r = user.post("/explain", {"prediction_id": baseline["id"], "question": "explain"})
    assert r.status_code == 200 and r.json()["source"] == "template" and "secret" not in r.text


def test_consents_are_appended_not_edited(user):
    consent(user); consent(user, False)
    c = user.get("/privacy/consents").json()
    assert c["current"]["ai_explainer"]["granted"] is False and c["history_count"] == 3  # data_processing + two changes
    assert user.post("/privacy/consents", {"consent_type": "data_processing", "granted": False}).status_code == 422


# ---- reports and share links ---------------------------------------------------------------------------------

def seed(u):
    when = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    u.put("/profile", {"sex": "female", "height_cm": 165, "date_of_birth": "1988-05-01"})
    u.post("/measurements", {"measurement_type": "weight_kg", "value": 80, "unit": "kg", "recorded_at": when})


def test_report_has_facts_but_no_identity(user, baseline):
    seed(user)
    r = user.get("/report")
    b = r.json()
    assert b["estimates"][0]["condition"] == "diabetes" and b["measurements"][0]["latest"] == 80 and "not a diagnosis" in b["disclaimer"].lower()
    assert user.email not in r.text and "display_name" not in r.text and "date_of_birth" not in r.text


def test_share_link_is_public_read_only_scoped_and_revocable(client, user, other, baseline):
    seed(user)
    made = user.post("/share", {"expires_in_days": 3, "include": ["measurements"]})
    assert made.status_code == 201
    token, link_id = made.json()["token"], made.json()["id"]
    assert len(token) >= 40 and made.json()["path"] == f"/shared/{token}"
    anon = client.get(f"/api/v1/shared/{token}")
    assert anon.status_code == 200
    b = anon.json()
    assert b["shared"] is True and "measurements" in b and "estimates" not in b and "profile" not in b and user.email not in anon.text
    assert token not in str(user.get("/share").json()), "the token is shown once and never listed"
    assert other.delete(f"/share/{link_id}").status_code == 404
    assert user.delete(f"/share/{link_id}").status_code == 204
    gone = client.get(f"/api/v1/shared/{token}")
    unknown = client.get("/api/v1/shared/not-a-real-token")
    assert gone.status_code == unknown.status_code == 404 and gone.json() == unknown.json()
    assert user.get("/share").json()["items"][0]["revoked"] is True


def test_expired_links_stop_working_and_only_a_hash_is_stored(client, user):
    token = user.post("/share", {"include": ["estimates"]}).json()["token"]
    with client.app.state.sessionmaker() as db:
        row = db.scalars(select(T.ShareLink)).one()
        assert token not in row.token_hash and len(row.token_hash) == 64
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
    assert client.get(f"/api/v1/shared/{token}").status_code == 404
    assert user.get("/share").json()["items"][0]["active"] is False


def test_share_validation_and_rate_limit(client, user):
    assert user.post("/share", {"expires_in_days": 365}).status_code == 422
    assert user.post("/share", {"include": []}).status_code == 422
    assert user.post("/share", {"include": ["email"]}).status_code == 422
    assert client.get("/api/v1/share").status_code == 401


def test_deleting_the_account_kills_its_share_links(client, user):
    token = user.post("/share", {}).json()["token"]
    assert client.get(f"/api/v1/shared/{token}").status_code == 200
    assert user.delete("/privacy/account", json={"password": PASSWORD}).status_code == 202
    assert client.get(f"/api/v1/shared/{token}").status_code == 404
