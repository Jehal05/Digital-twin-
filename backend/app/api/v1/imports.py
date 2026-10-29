from __future__ import annotations

from fastapi import APIRouter, Depends, File, Request, UploadFile
from sqlalchemy.orm import Session

from app.api.v1.measurements import _create
from app.core.db import get_db
from app.core.errors import ApiError
from app.core.security import audit, current_user
from app.ingestion import csv_import, lab_ocr
from app.models.tables import User
from app.schemas.api import CommitIn

router = APIRouter(prefix="/imports", tags=["imports"])


async def _read(file: UploadFile, limit: int) -> bytes:
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise ApiError(413, "file_too_large", f"File is larger than {limit // 1024 // 1024} MB.")
    return data


@router.post("/csv/preview")
async def csv_preview(request: Request, file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Parses and validates only. Nothing is saved until /imports/commit."""
    data = await _read(file, csv_import.MAX_BYTES)
    try:
        result = csv_import.parse(data)
    except csv_import.CsvError as e:
        raise ApiError(422, "invalid_file", str(e), {"file": str(e)}) from None
    audit(db, request, "import_preview", user.id, {"kind": "csv", "rows": len(result["rows"])})
    db.commit()
    return {"content_kind": "measured", **result}


@router.post("/lab-report/preview")
async def lab_preview(request: Request, file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Reads a lab report image/PDF in memory and proposes values. The file itself is discarded, never stored."""
    data = await _read(file, lab_ocr.MAX_BYTES)
    try:
        text, conf, method = lab_ocr.extract_text(data)
    except lab_ocr.ReportError as e:
        raise ApiError(422, "invalid_file", str(e), {"file": str(e)}) from None
    result = lab_ocr.candidates(text, conf)
    audit(db, request, "import_preview", user.id, {"kind": "lab_report", "method": method, "found": len(result["candidates"])})
    db.commit()
    return {"method": method, "ocr_confidence": conf, "file_stored": False, **result}


@router.post("/commit", status_code=201)
def commit(body: CommitIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Saves rows the user has reviewed. Each row is validated again here; one bad row never blocks the others."""
    created, skipped, errors, flagged = 0, 0, [], 0
    for i, r in enumerate(body.rows):
        try:
            with db.begin_nested():
                m = _create(db, user, r.measurement_type, r.value, r.unit, r.recorded_at, source=body.source, ocr_confidence=r.ocr_confidence)
                db.flush()
            created += 1
            flagged += m.validation_status == "flagged"
        except ApiError as e:
            if e.status == 409:
                skipped += 1
            else:
                errors.append({"index": i, "message": next(iter(e.fields.values()), e.message) if e.fields else e.message})
    audit(db, request, "import_commit", user.id, {"source": body.source, "created": created, "skipped": skipped, "errors": len(errors)})
    db.commit()
    return {"created": created, "skipped_duplicates": skipped, "flagged": flagged, "errors": errors}
