import io

import shutil

import pytest
from PIL import Image, ImageDraw, ImageFont

needs_tesseract = pytest.mark.skipif(shutil.which("tesseract") is None, reason="tesseract-ocr not installed")
CSV_WIDE = "date,steps,sleep_hours,resting_hr,weight_kg\n2026-10-01,8000,7.5,62,80.5\n2026-10-02,9100,6,64,\n2026-10-03,abc,6,64,80\n"


def upload(u, path, name, data, ctype="text/csv"):
    return u.client.post(f"/api/v1{path}", headers=u.h, files={"file": (name, data, ctype)})


def lab_image(lines):
    img = Image.new("RGB", (1000, 140 + 70 * len(lines)), "white")
    d = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=34)
    for i, line in enumerate(lines):
        d.text((40, 40 + i * 70), line, fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def test_csv_preview_validates_every_row_and_saves_nothing(user):
    r = upload(user, "/imports/csv/preview", "w.csv", CSV_WIDE)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["layout"] == "wide" and b["summary"] == {"ok": 10, "errors": 1}
    bad = [x for x in b["rows"] if x["status"] == "error"]
    assert bad[0]["line"] == 4 and bad[0]["measurement_type"] == "steps" and "number" in bad[0]["message"]
    assert all(x.get("note") for x in b["rows"] if x["status"] == "ok"), "bare dates must say the time was assumed"
    assert user.get("/measurements").json()["items"] == []


def test_csv_long_layout_converts_units_and_rejects_implausible_values(user):
    csv = ("measurement_type,value,unit,recorded_at\nglucose,5.5,mmol/L,2026-10-01T08:00:00+05:30\n"
           "glucose,5000,mg/dL,2026-10-01T09:00:00+05:30\nbogus,1,x,2026-10-01\n")
    rows = upload(user, "/imports/csv/preview", "l.csv", csv).json()["rows"]
    assert [r["status"] for r in rows] == ["ok", "error", "error"]
    assert "plausible" in rows[1]["message"] and "unknown" in rows[2]["message"]
    assert rows[0]["recorded_at"] == "2026-10-01T02:30:00Z"


@pytest.mark.parametrize("data,msg", [("", "empty"), ("steps\n5\n", "date column"), ("date,mystery\n2026-01-01,5\n", "recognised"),
                                      (b"\xff\xfe\x00bad", "UTF-8")])
def test_csv_structural_problems_are_422_with_a_reason(user, data, msg):
    r = upload(user, "/imports/csv/preview", "x.csv", data)
    assert r.status_code == 422 and msg in r.json()["error"]["message"]


def test_csv_future_dates_rejected_and_oversize_file_refused(user):
    rows = upload(user, "/imports/csv/preview", "f.csv", "date,steps\n2999-01-01,5\n").json()["rows"]
    assert rows[0]["status"] == "error" and "future" in rows[0]["message"]
    assert upload(user, "/imports/csv/preview", "big.csv", "date,steps\n" + "2026-01-01,1\n" * 300_000).status_code in (413, 422)


def test_commit_saves_reviewed_rows_skips_duplicates_and_keeps_going_after_a_bad_row(user):
    rows = [{"measurement_type": "steps", "value": 8000, "unit": "count", "recorded_at": "2026-10-01T12:00:00Z"},
            {"measurement_type": "glucose_mgdl", "value": 9999, "unit": "mg/dL", "recorded_at": "2026-10-01T12:00:00Z"},
            {"measurement_type": "sleep_hours", "value": 7, "unit": "h", "recorded_at": "2026-10-01T12:00:00Z"}]
    r = user.post("/imports/commit", {"source": "csv", "rows": rows})
    assert r.status_code == 201 and r.json()["created"] == 2 and len(r.json()["errors"]) == 1 and r.json()["errors"][0]["index"] == 1
    again = user.post("/imports/commit", {"source": "csv", "rows": [rows[0]]}).json()
    assert again["created"] == 0 and again["skipped_duplicates"] == 1
    items = user.get("/measurements").json()["items"]
    assert len(items) == 2 and {m["source"] for m in items} == {"csv"}


def test_commit_is_scoped_to_the_caller_and_rejects_extra_fields(user, other):
    row = {"measurement_type": "steps", "value": 1, "unit": "count", "recorded_at": "2026-10-01T12:00:00Z"}
    user.post("/imports/commit", {"source": "csv", "rows": [row]})
    assert other.get("/measurements").json()["items"] == []
    assert user.post("/imports/commit", {"source": "csv", "rows": [{**row, "user_id": other.id}]}).status_code == 422
    assert user.post("/imports/commit", {"source": "csv", "rows": [row] * 501}).status_code == 422


@needs_tesseract
def test_lab_report_image_is_read_and_values_are_proposed_not_saved(user):
    png = lab_image(["Fasting Glucose 126 mg/dL", "Total Cholesterol 210 mg/dL", "BP 128/84 mmHg", "Collected 2026-10-20"])
    r = upload(user, "/imports/lab-report/preview", "report.png", png, "image/png")
    assert r.status_code == 200, r.text
    b = r.json()
    found = {(c["measurement_type"], c["value"]) for c in b["candidates"]}
    assert {("glucose_mgdl", 126.0), ("cholesterol_mgdl", 210.0), ("bp_systolic", 128.0), ("bp_diastolic", 84.0)} <= found
    assert b["method"] == "ocr" and b["file_stored"] is False and "2026-10-20" in b["detected_dates"]
    assert all(c["snippet"] and c["confidence"] in {"high", "medium", "low"} for c in b["candidates"])
    assert user.get("/measurements").json()["items"] == []


@needs_tesseract
def test_lab_report_never_guesses_ambiguous_dates(user):
    b = upload(user, "/imports/lab-report/preview", "r.png", lab_image(["Glucose 99 mg/dL", "Date 03/04/2026"]), "image/png").json()
    assert b["detected_dates"] == [] and b["ambiguous_dates_found"] is True


def test_lab_report_type_is_decided_by_content_not_by_name_or_header(user):
    r = upload(user, "/imports/lab-report/preview", "evil.png", b"<html><script>alert(1)</script></html>", "image/png")
    assert r.status_code == 422 and "Unsupported" in r.json()["error"]["message"]
    assert upload(user, "/imports/lab-report/preview", "r.pdf", b"%PDF-1.4 not really a pdf", "application/pdf").status_code == 422


def test_pdf_with_a_text_layer_is_read_without_ocr(user):
    import pdfplumber  # noqa: F401
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 750, "Total Cholesterol: 5.2 mmol/L")
    c.drawString(72, 730, "Report date 12 Oct 2026")
    c.save()
    b = upload(user, "/imports/lab-report/preview", "r.pdf", buf.getvalue(), "application/pdf").json()
    assert b["method"] == "pdf_text" and b["ocr_confidence"] is None
    chol = [c for c in b["candidates"] if c["measurement_type"] == "cholesterol_mgdl"][0]
    assert chol["value"] == 5.2 and chol["unit"] == "mmol/L" and b["detected_dates"] == ["2026-10-12"]


def test_import_endpoints_need_login(client):
    assert client.post("/api/v1/imports/commit", json={}).status_code == 401
    assert client.post("/api/v1/imports/csv/preview", files={"file": ("a.csv", "x")}).status_code == 401
