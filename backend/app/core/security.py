from __future__ import annotations

import hashlib
import secrets
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import get_db
from app.core.errors import ApiError
from app.models.tables import AuditEvent, User

_hasher = PasswordHasher()
_DUMMY_HASH = _hasher.hash("timing-equaliser-not-a-real-password")
_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored_hash: str | None, password: str) -> bool:
    """Always does one hash verification, even for unknown users, so response time doesn't reveal which emails exist."""
    try:
        return _hasher.verify(stored_hash or _DUMMY_HASH, password) and stored_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_refresh_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(48)
    return raw, sha256(raw)


def create_access_token(user_id: uuid.UUID, settings: Settings) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "type": "access", "iat": now, "jti": uuid.uuid4().hex,
               "exp": now + timedelta(minutes=settings.access_token_minutes)}
    return jwt.encode(payload, settings.resolved_secret(), algorithm="HS256")


def current_user(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
                 db: Session = Depends(get_db)) -> User:
    unauth = ApiError(401, "unauthenticated", "Sign in to continue.", headers={"WWW-Authenticate": "Bearer"})
    if creds is None:
        raise unauth
    try:
        payload = jwt.decode(creds.credentials, request.app.state.settings.resolved_secret(), algorithms=["HS256"],
                             options={"require": ["exp", "sub", "type"]})
        if payload["type"] != "access":
            raise unauth
        user = db.get(User, uuid.UUID(payload["sub"]))
    except (jwt.PyJWTError, ValueError):
        raise unauth from None
    if user is None or user.status != "active":
        raise unauth
    return user


class RateLimiter:
    """Sliding-window limiter, in memory. Fine for one process; use a shared store (Redis) when running several."""

    def __init__(self, per_minute: int):
        self.per_minute, self.hits = per_minute, defaultdict(deque)

    def check(self, key: str) -> None:
        now, q = time.monotonic(), self.hits[key]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= self.per_minute:
            raise ApiError(429, "rate_limited", "Too many attempts. Please wait a minute and try again.",
                           headers={"Retry-After": "60"})
        q.append(now)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def audit(db: Session, request: Request, event_type: str, user_id: uuid.UUID | None, detail: dict | None = None) -> None:
    """Security-relevant events only. `detail` must never contain passwords, tokens or health values."""
    ip_hash = sha256(request.app.state.settings.resolved_secret() + client_ip(request))[:32]
    db.add(AuditEvent(user_id=user_id, event_type=event_type, ip_hash=ip_hash, detail=detail))
