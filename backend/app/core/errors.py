"""One error shape for the whole API: {"error": {"code", "message", "fields"}}."""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("healthtwin")

_CODES = {400: "bad_request", 401: "unauthenticated", 403: "forbidden", 404: "not_found", 405: "method_not_allowed",
          409: "conflict", 413: "payload_too_large", 422: "validation_error", 429: "rate_limited", 503: "unavailable"}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, fields: dict[str, str] | None = None, headers: dict | None = None):
        self.status, self.code, self.message, self.fields, self.headers = status, code, message, fields or {}, headers


def body(code: str, message: str, fields: dict | None = None) -> dict:
    return {"error": {"code": code, "message": message, "fields": fields or {}}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api(_: Request, e: ApiError):
        return JSONResponse(body(e.code, e.message, e.fields), status_code=e.status, headers=e.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, e: RequestValidationError):
        fields = {}
        for err in e.errors():
            loc = ".".join(str(p) for p in err["loc"] if p not in ("body", "query", "path"))
            fields[loc or "request"] = err["msg"]  # never echo the submitted value (may be sensitive)
        return JSONResponse(body("validation_error", "Some inputs are invalid.", fields), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException):
        return JSONResponse(body(_CODES.get(e.status_code, "error"), str(e.detail)), status_code=e.status_code,
                            headers=getattr(e, "headers", None))

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, e: Exception):
        log.error("unhandled error: %s", type(e).__name__)  # type only: messages can contain health data
        return JSONResponse(body("internal_error", "Something went wrong."), status_code=500)
