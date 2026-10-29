import pytest

from tests.conftest import CONSENT, PASSWORD, User

R = "/api/v1/auth"


def test_register_requires_data_processing_consent(client):
    r = client.post(f"{R}/register", json={"email": "a@example.com", "password": PASSWORD, "consents": []})
    assert r.status_code == 422 and r.json()["error"]["code"] == "consent_required"
    r = client.post(f"{R}/register", json={"email": "a@example.com", "password": PASSWORD,
                                           "consents": [{"type": "data_processing", "granted": False}]})
    assert r.status_code == 422


@pytest.mark.parametrize("pw", ["short1!", "1234567890123", "onlylettersandmore", "aaaaaaaaaaaa1"])
def test_weak_passwords_rejected(client, pw):
    r = client.post(f"{R}/register", json={"email": "w@example.com", "password": pw, "consents": CONSENT})
    assert r.status_code == 422 and "password" in r.json()["error"]["fields"]


def test_duplicate_email_conflict_case_insensitive(client):
    User(client, "dup@example.com")
    r = client.post(f"{R}/register", json={"email": "DUP@example.com", "password": PASSWORD, "consents": CONSENT})
    assert r.status_code == 409


def test_login_success_and_generic_failure(client):
    u = User(client, "login@example.com")
    ok = client.post(f"{R}/login", json={"email": "login@example.com", "password": PASSWORD})
    assert ok.status_code == 200 and {"access_token", "refresh_token"} <= set(ok.json())
    wrong = client.post(f"{R}/login", json={"email": "login@example.com", "password": "Wrong-password-1"})
    ghost = client.post(f"{R}/login", json={"email": "nobody@example.com", "password": "Wrong-password-1"})
    assert wrong.status_code == ghost.status_code == 401
    assert wrong.json() == ghost.json(), "must not reveal whether the email exists"


def test_protected_endpoints_need_a_valid_token(client):
    assert client.get("/api/v1/profile").status_code == 401
    assert client.get("/api/v1/profile", headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_refresh_token_is_not_accepted_as_access_token(client, user):
    r = client.get("/api/v1/profile", headers={"Authorization": f"Bearer {user.refresh}"})
    assert r.status_code == 401


def test_refresh_rotates_and_reuse_revokes_the_whole_family(client, user):
    first = user.refresh
    r1 = client.post(f"{R}/refresh", json={"refresh_token": first})
    assert r1.status_code == 200
    second = r1.json()["refresh_token"]
    assert second != first
    # replaying the old token is treated as theft ...
    assert client.post(f"{R}/refresh", json={"refresh_token": first}).status_code == 401
    # ... and kills the newer token from the same family too
    assert client.post(f"{R}/refresh", json={"refresh_token": second}).status_code == 401


def test_logout_revokes_refresh_token(client, user):
    assert client.post(f"{R}/logout", json={"refresh_token": user.refresh}).status_code == 204
    assert client.post(f"{R}/refresh", json={"refresh_token": user.refresh}).status_code == 401


def test_auth_rate_limit(tmp_path):
    from fastapi.testclient import TestClient

    from app.core.config import Settings
    from app.main import create_app
    s = Settings(env="test", database_url=f"sqlite:///{tmp_path}/rl.db", auth_rate_limit_per_minute=3)
    with TestClient(create_app(s)) as c:
        codes = [c.post(f"{R}/login", json={"email": "x@example.com", "password": "Wrong-password-1"}).status_code for _ in range(5)]
    assert codes[:3] == [401, 401, 401] and codes[3:] == [429, 429]


def test_error_shape_never_echoes_secrets(client):
    r = client.post(f"{R}/login", json={"email": "not-an-email", "password": "SuperSecret-123"})
    assert r.status_code == 422 and "SuperSecret-123" not in r.text
    assert set(r.json()["error"]) == {"code", "message", "fields"}


def test_security_headers_present(client):
    r = client.get("/healthz")
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["cache-control"] == "no-store"
