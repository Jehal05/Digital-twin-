import itertools
import os

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.db import Base
from app.main import create_app

PASSWORD = "Correct-horse-42"
_counter = itertools.count(1)
CONSENT = [{"type": "data_processing", "granted": True}]


@pytest.fixture()
def client(tmp_path):
    # Set HT_TEST_DATABASE_URL (e.g. postgresql+psycopg://user:pw@host/db) to run the whole suite against PostgreSQL.
    url = os.environ.get("HT_TEST_DATABASE_URL") or f"sqlite:///{tmp_path}/test.db"
    settings = Settings(env="test", database_url=url, auth_rate_limit_per_minute=1000)
    app = create_app(settings)
    if not url.startswith("sqlite"):
        with app.state.engine.begin() as conn:
            Base.metadata.drop_all(conn)
    with TestClient(app) as c:
        yield c


class User:
    def __init__(self, client, email=None):
        self.client = client
        self.email = email or f"user{next(_counter)}@example.com"
        r = client.post("/api/v1/auth/register", json={"email": self.email, "password": PASSWORD, "consents": CONSENT})
        assert r.status_code == 201, r.text
        body = r.json()
        self.id, self.access, self.refresh = body["user"]["id"], body["access_token"], body["refresh_token"]

    @property
    def h(self):
        return {"Authorization": f"Bearer {self.access}"}

    def get(self, url, **kw):
        return self.client.get(f"/api/v1{url}", headers=self.h, **kw)

    def post(self, url, json=None, **kw):
        return self.client.post(f"/api/v1{url}", headers=self.h, json=json, **kw)

    def put(self, url, json=None):
        return self.client.put(f"/api/v1{url}", headers=self.h, json=json)

    def delete(self, url, **kw):
        return self.client.request("DELETE", f"/api/v1{url}", headers=self.h, **kw)


@pytest.fixture()
def user(client):
    return User(client)


@pytest.fixture()
def other(client):
    return User(client)


PROFILE = {"pregnancies": 2, "glucose": 140, "blood_pressure": 78, "bmi": 31.0, "age": 38}


@pytest.fixture()
def baseline(user):
    r = user.post("/predictions/diabetes", {"features": PROFILE})
    assert r.status_code == 201, r.text
    return r.json()
