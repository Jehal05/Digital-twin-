"""Wearable / spreadsheet CSV import. Parsing only: nothing is written until the user reviews and commits the rows.

Accepted layouts
  long : measurement_type,value,unit,recorded_at
  wide : a date/time column plus any of the catalogue types as columns (e.g. date,steps,sleep_hours,resting_hr,weight_kg)
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, time, timezone

from app.services import measurements as svc

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 5000
TIME_COLUMNS = ("recorded_at", "timestamp", "datetime", "date", "time")
ALIASES = {
    "weight": "weight_kg", "weight_kg": "weight_kg", "height": "height_cm", "height_cm": "height_cm", "bmi": "bmi",
    "glucose": "glucose_mgdl", "glucose_mgdl": "glucose_mgdl", "glucose_mg_dl": "glucose_mgdl",
    "systolic": "bp_systolic", "bp_systolic": "bp_systolic", "diastolic": "bp_diastolic", "bp_diastolic": "bp_diastolic",
    "cholesterol": "cholesterol_mgdl", "cholesterol_mgdl": "cholesterol_mgdl", "resting_hr": "resting_hr",
    "resting_heart_rate": "resting_hr", "heart_rate_max": "heart_rate_max", "max_hr": "heart_rate_max", "steps": "steps",
    "sleep": "sleep_hours", "sleep_hours": "sleep_hours",
}


class CsvError(ValueError):
    pass


def _norm(h: str) -> str:
    return h.strip().lower().replace(" ", "_").replace("-", "_").lstrip("﻿")


def _parse_time(raw: str) -> tuple[datetime, bool]:
    """Returns (utc datetime, assumed). A bare date is taken as 12:00 UTC and flagged as assumed; naive times are taken as UTC."""
    raw = raw.strip()
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("unrecognised date; use ISO format such as 2026-10-29 or 2026-10-29T08:30:00+05:30") from None
    assumed = False
    if len(raw) <= 10:
        dt, assumed = datetime.combine(dt.date(), time(12, 0)), True
    if dt.tzinfo is None:
        dt, assumed = dt.replace(tzinfo=timezone.utc), True
    return dt.astimezone(timezone.utc), assumed


def _check(mtype: str, raw_value: str, unit: str | None, when: str, now: datetime) -> dict:
    row = {"measurement_type": mtype, "unit": unit, "raw_value": raw_value}
    try:
        value = float(raw_value)
        unit = unit or svc.CATALOG[mtype].canonical_unit
        row["unit"] = unit
        svc.to_canonical(mtype, value, unit)
        dt, assumed = _parse_time(when)
        svc.check_time(dt, now)
        row.update(value=value, recorded_at=dt.isoformat().replace("+00:00", "Z"), status="ok")
        if assumed:
            row["note"] = "No time or timezone given; assumed 12:00 UTC."
    except svc.MeasurementError as e:
        row.update(status="error", message=e.message)
    except (ValueError, KeyError) as e:
        row.update(status="error", message=str(e) if not isinstance(e, ValueError) or "date" in str(e) else "value must be a number")
    return row


def parse(data: bytes, now: datetime | None = None) -> dict:
    if len(data) > MAX_BYTES:
        raise CsvError(f"File is larger than {MAX_BYTES // 1024 // 1024} MB.")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise CsvError("File is not UTF-8 text. Export the CSV as UTF-8.") from None
    now = now or datetime.now(timezone.utc)
    reader = csv.reader(io.StringIO(text))
    try:
        header = [_norm(h) for h in next(reader)]
    except StopIteration:
        raise CsvError("The file is empty.") from None
    out: list[dict] = []
    long_layout = {"measurement_type", "value"} <= set(header)
    time_col = next((c for c in TIME_COLUMNS if c in header), None)
    if time_col is None:
        raise CsvError("No date column found. Add one named recorded_at, timestamp, datetime or date.")
    wide_cols = {i: ALIASES[h] for i, h in enumerate(header) if h in ALIASES}
    if not long_layout and not wide_cols:
        raise CsvError(f"No recognised measurement columns. Known names: {sorted(set(ALIASES))}.")
    ti = header.index(time_col)
    for line, cells in enumerate(reader, start=2):
        if not any(c.strip() for c in cells):
            continue
        if len(out) >= MAX_ROWS:
            raise CsvError(f"More than {MAX_ROWS} rows. Split the file.")
        cells = cells + [""] * (len(header) - len(cells))
        if long_layout:
            mt = ALIASES.get(_norm(cells[header.index("measurement_type")]), _norm(cells[header.index("measurement_type")]))
            unit = cells[header.index("unit")].strip() if "unit" in header else ""
            if mt not in svc.CATALOG:
                out.append({"line": line, "status": "error", "measurement_type": mt, "message": "unknown measurement type"})
                continue
            out.append({"line": line, **_check(mt, cells[header.index("value")], unit or None, cells[ti], now)})
        else:
            for i, mt in wide_cols.items():
                if cells[i].strip() == "":
                    continue
                out.append({"line": line, **_check(mt, cells[i], None, cells[ti], now)})
    return {"rows": out, "summary": {"ok": sum(r["status"] == "ok" for r in out), "errors": sum(r["status"] == "error" for r in out)},
            "layout": "long" if long_layout else "wide"}
