from datetime import datetime, timedelta, timezone

import pytest

NOW = datetime.now(timezone.utc)


def iso(dt):
    return dt.isoformat()


def add(u, mtype="glucose_mgdl", value=100, unit="mg/dL", when=None):
    return u.post("/measurements", {"measurement_type": mtype, "value": value, "unit": unit,
                                    "recorded_at": iso(when or NOW - timedelta(hours=1))})


def test_add_and_list_with_provenance(user):
    r = add(user, value=105)
    assert r.status_code == 201
    m = r.json()
    assert m["source"] == "manual" and m["content_kind"] == "measured" and m["validation_status"] == "valid"
    items = user.get("/measurements").json()["items"]
    assert len(items) == 1 and items[0]["value"] == 105 and items[0]["recorded_at"].endswith("Z")


@pytest.mark.parametrize("mtype,value,unit,canonical", [("glucose_mgdl", 5.5, "mmol/L", 99.088), ("weight_kg", 176, "lb", 79.832),
                                                         ("cholesterol_mgdl", 5.0, "mmol/L", 193.35), ("height_cm", 1.75, "m", 175.0)])
def test_unit_conversion_to_canonical(user, mtype, value, unit, canonical):
    assert add(user, mtype, value, unit).json()["value"] == pytest.approx(canonical, abs=0.01)


@pytest.mark.parametrize("mtype,value,unit,field", [("glucose_mgdl", 5000, "mg/dL", "value"), ("glucose_mgdl", 90, "kg", "unit"),
                                                     ("pulse_oxygen", 98, "%", "measurement_type"), ("bp_systolic", -5, "mmHg", "value")])
def test_invalid_measurements_rejected(user, mtype, value, unit, field):
    r = add(user, mtype, value, unit)
    assert r.status_code == 422 and field in r.json()["error"]["fields"]


def test_future_and_naive_timestamps_rejected(user):
    assert add(user, when=NOW + timedelta(days=1)).status_code == 422
    r = user.post("/measurements", {"measurement_type": "steps", "value": 100, "unit": "count", "recorded_at": "2026-01-01T10:00:00"})
    assert r.status_code == 422


def test_exact_duplicate_rejected(user):
    when = NOW - timedelta(days=1)
    assert add(user, when=when).status_code == 201
    assert add(user, when=when).status_code == 409
    assert add(user, value=101, when=when).status_code == 201  # different value is a different reading


def test_history_is_append_only_no_edit_or_delete_routes(user):
    mid = add(user).json()["id"]
    for method in ("put", "patch", "delete"):
        r = user.client.request(method.upper(), f"/api/v1/measurements/{mid}", headers=user.h, json={"value": 1})
        assert r.status_code in (404, 405), "no route may edit or delete a recorded reading"


def test_sudden_jump_is_flagged_and_can_be_confirmed(user):
    add(user, value=100, when=NOW - timedelta(hours=10))
    r = add(user, value=300, when=NOW - timedelta(hours=1)).json()
    assert r["validation_status"] == "flagged" and "jump_vs_previous" in r["flag_reason"]
    assert [m["id"] for m in user.get("/measurements/flagged").json()["items"]] == [r["id"]]
    ok = user.post(f"/measurements/{r['id']}/resolve", {"action": "confirm"}).json()
    assert ok["validation_status"] == "valid" and ok["value"] == 300
    assert user.get("/measurements/flagged").json()["items"] == []


def test_correcting_a_flagged_reading_adds_a_new_row_and_keeps_history(user):
    add(user, value=100, when=NOW - timedelta(hours=10))
    bad = add(user, value=300, when=NOW - timedelta(hours=1)).json()
    fixed = user.post(f"/measurements/{bad['id']}/resolve", {"action": "correct", "value": 110}).json()
    assert fixed["id"] != bad["id"] and fixed["value"] == 110 and fixed["validation_status"] == "valid"
    values = sorted(m["value"] for m in user.get("/measurements").json()["items"])
    assert values == [100, 110], "the wrong reading is hidden from history but not edited in place"


def test_pagination_with_cursor(user):
    for i in range(5):
        add(user, "steps", 1000 + i, "count", NOW - timedelta(days=i + 1))
    p1 = user.get("/measurements", params={"limit": 2}).json()
    p2 = user.get("/measurements", params={"limit": 2, "cursor": p1["next_cursor"]}).json()
    p3 = user.get("/measurements", params={"limit": 2, "cursor": p2["next_cursor"]}).json()
    seen = [m["value"] for p in (p1, p2, p3) for m in p["items"]]
    assert seen == [1000, 1001, 1002, 1003, 1004] and p3["next_cursor"] is None


def test_date_and_type_filters(user):
    add(user, "steps", 500, "count", NOW - timedelta(days=30))
    add(user, "steps", 900, "count", NOW - timedelta(days=1))
    add(user, "sleep_hours", 7, "h", NOW - timedelta(days=1))
    since = iso(NOW - timedelta(days=7))
    items = user.get("/measurements", params={"measurement_type": "steps", "from": since}).json()["items"]
    assert [m["value"] for m in items] == [900]
