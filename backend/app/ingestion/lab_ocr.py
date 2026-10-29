"""Lab report reading: text extraction (PDF text layer or OCR) and rule-based candidate detection.

Nothing here is trusted. Every candidate is shown to the user with its source snippet and confidence, and nothing is saved
until they confirm or correct it. Dates are never guessed from ambiguous formats like 03/04/2026.
"""
from __future__ import annotations

import io
import re

MAX_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 25_000_000
MAGIC = {b"\x89PNG\r\n\x1a\n": "png", b"\xff\xd8\xff": "jpeg", b"%PDF-": "pdf"}


class ReportError(ValueError):
    pass


def sniff(data: bytes) -> str:
    """Decide the type from the bytes, never from the filename or the client's Content-Type."""
    for sig, kind in MAGIC.items():
        if data.startswith(sig):
            return kind
    raise ReportError("Unsupported file. Upload a PNG, JPEG or PDF.")


def extract_text(data: bytes) -> tuple[str, float | None, str]:
    """Returns (text, mean OCR word confidence 0-1 or None for a text layer, method)."""
    if len(data) > MAX_BYTES:
        raise ReportError(f"File is larger than {MAX_BYTES // 1024 // 1024} MB.")
    kind = sniff(data)
    if kind == "pdf":
        import pdfplumber
        try:
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                if len(pdf.pages) > 10:
                    raise ReportError("PDF has more than 10 pages.")
                text = "\n".join((p.extract_text() or "") for p in pdf.pages)
                if text.strip():
                    return text, None, "pdf_text"
                images = [p.to_image(resolution=200).original for p in pdf.pages[:3]]
        except ReportError:
            raise
        except Exception:
            raise ReportError("Could not read this PDF.") from None
        return _ocr_images(images)
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception:
        raise ReportError("Could not read this image.") from None
    return _ocr_images([img])


def _ocr_images(images) -> tuple[str, float | None, str]:
    try:
        import pytesseract
        texts, confs = [], []
        for img in images:
            d = pytesseract.image_to_data(img.convert("L"), output_type=pytesseract.Output.DICT)
            texts.append(pytesseract.image_to_string(img.convert("L")))
            confs += [float(c) for c, w in zip(d["conf"], d["text"]) if str(c) != "-1" and w.strip()]
    except Exception:
        raise ReportError("Text recognition is not available on this server. Enter the values by hand instead.") from None
    return "\n".join(texts), (sum(confs) / len(confs) / 100 if confs else 0.0), "ocr"


NUM = r"(\d{1,4}(?:[.,]\d{1,2})?)"
UNIT_GLU = r"(mg\s*/\s*dl|mmol\s*/\s*l)"
UNIT_CHOL = r"(mg\s*/\s*dl|mmol\s*/\s*l)"
RULES = [
    ("glucose_mgdl", re.compile(rf"(?:fasting\s+)?(?:blood\s+)?(?:glucose|sugar|fbs|rbs|ppbs)[^\d\n]{{0,25}}{NUM}\s*{UNIT_GLU}?", re.I)),
    ("cholesterol_mgdl", re.compile(rf"(?:total\s+cholesterol|cholesterol[,\s]*total|cholesterol)[^\d\n]{{0,25}}{NUM}\s*{UNIT_CHOL}?", re.I)),
    ("weight_kg", re.compile(rf"weight[^\d\n]{{0,15}}{NUM}\s*(kg|lbs?)?", re.I)),
    ("height_cm", re.compile(rf"height[^\d\n]{{0,15}}{NUM}\s*(cm|m|in)?", re.I)),
]
BP = re.compile(r"(?:bp|blood\s+pressure)[^\d\n]{0,15}(\d{2,3})\s*/\s*(\d{2,3})\s*(mm\s*hg)?", re.I)
DATE_ISO = re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})\b")
DATE_TEXT = re.compile(r"\b(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]*(20\d{2})\b")
DATE_AMBIGUOUS = re.compile(r"\b\d{1,2}[/.]\d{1,2}[/.](?:20)?\d{2}\b")
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def _num(s: str) -> float:
    return float(s.replace(",", "."))


def candidates(text: str, ocr_confidence: float | None) -> dict:
    found = []
    for mtype, rx in RULES:
        for m in rx.finditer(text):
            value, unit = _num(m.group(1)), (m.group(2) or "").replace(" ", "")
            canonical_default = {"glucose_mgdl": "mg/dL", "cholesterol_mgdl": "mg/dL", "weight_kg": "kg", "height_cm": "cm"}[mtype]
            unit_seen = bool(unit)
            unit = {"mg/dl": "mg/dL", "mmol/l": "mmol/L"}.get(unit.lower(), unit) or canonical_default
            found.append({"measurement_type": mtype, "value": value, "unit": unit, "unit_found_in_text": unit_seen,
                          "snippet": text[max(0, m.start()):m.end()].strip()[:80],
                          "confidence": _confidence(unit_seen, ocr_confidence)})
    for m in BP.finditer(text):
        for mtype, v in (("bp_systolic", m.group(1)), ("bp_diastolic", m.group(2))):
            found.append({"measurement_type": mtype, "value": float(v), "unit": "mmHg", "unit_found_in_text": bool(m.group(3)),
                          "snippet": text[max(0, m.start()):m.end()].strip()[:80], "confidence": _confidence(bool(m.group(3)), ocr_confidence)})
    dates = [f"{y}-{mo}-{d}" for y, mo, d in DATE_ISO.findall(text)]
    for d, mon, y in DATE_TEXT.findall(text):
        if mon[:3].lower() in MONTHS:
            dates.append(f"{y}-{MONTHS[mon[:3].lower()]:02d}-{int(d):02d}")
    return {"candidates": found, "detected_dates": sorted(set(dates)),
            "ambiguous_dates_found": bool(DATE_AMBIGUOUS.search(text)),
            "note": "Check every value against your report. Pick the date the sample was taken."}


def _confidence(unit_seen: bool, ocr: float | None) -> str:
    score = (0.6 if unit_seen else 0.3) + (0.4 * ocr if ocr is not None else 0.4)
    return "high" if score >= 0.85 else "medium" if score >= 0.6 else "low"
