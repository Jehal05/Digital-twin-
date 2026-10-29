from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import ApiError
from app.core.security import (audit, client_ip, create_access_token, hash_password, new_refresh_token, sha256,
                               verify_password)
from app.models.tables import Consent, HealthProfile, RefreshToken, User, UserPreference
from app.schemas.api import LoginIn, RefreshIn, RegisterIn

router = APIRouter(prefix="/auth", tags=["auth"])


def _limit(request: Request) -> None:
    request.app.state.auth_limiter.check(f"{request.url.path}:{client_ip(request)}")


def _issue(db: Session, request: Request, user: User, family_id: uuid.UUID | None = None) -> dict:
    s = request.app.state.settings
    raw, digest = new_refresh_token()
    db.add(RefreshToken(user_id=user.id, family_id=family_id or uuid.uuid4(), token_hash=digest,
                        expires_at=datetime.now(timezone.utc) + timedelta(days=s.refresh_token_days)))
    return {"access_token": create_access_token(user.id, s), "refresh_token": raw, "token_type": "bearer",
            "expires_in": s.access_token_minutes * 60}


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    _limit(request)
    granted = {c.type for c in body.consents if c.granted}
    if "data_processing" not in granted:
        raise ApiError(422, "consent_required", "Consent to data processing is required to create an account.",
                       {"consents": "data_processing must be granted"})
    email = body.email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise ApiError(409, "conflict", "An account with this email already exists.")
    s = request.app.state.settings
    user = User(email=email, password_hash=hash_password(body.password), display_name=body.display_name)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "conflict", "An account with this email already exists.") from None
    db.add_all([HealthProfile(user_id=user.id), UserPreference(user_id=user.id)])
    db.add_all(Consent(user_id=user.id, consent_type=c.type, granted=c.granted, policy_version=s.policy_version)
               for c in body.consents)
    tokens = _issue(db, request, user)
    audit(db, request, "register", user.id)
    db.commit()
    return {"user": {"id": str(user.id), "email": user.email, "display_name": user.display_name}, **tokens}


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    _limit(request)
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    ok = verify_password(user.password_hash if user else None, body.password)
    if not ok or user is None or user.status != "active":
        audit(db, request, "login_failed", user.id if user else None)
        db.commit()
        raise ApiError(401, "invalid_credentials", "Email or password is incorrect.")
    tokens = _issue(db, request, user)
    audit(db, request, "login", user.id)
    db.commit()
    return tokens


@router.post("/refresh")
def refresh(body: RefreshIn, request: Request, db: Session = Depends(get_db)):
    _limit(request)
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha256(body.refresh_token)))
    invalid = ApiError(401, "invalid_token", "Session expired. Please sign in again.")
    if row is None:
        raise invalid
    now = datetime.now(timezone.utc)
    if row.revoked_at is not None:
        # A rotated-out token was presented again: treat as theft and end every session in this family.
        db.execute(update(RefreshToken).where(RefreshToken.family_id == row.family_id, RefreshToken.revoked_at.is_(None))
                   .values(revoked_at=now))
        audit(db, request, "refresh_token_reuse", row.user_id)
        db.commit()
        raise invalid
    user = db.get(User, row.user_id)
    if row.expires_at < now or user is None or user.status != "active":
        raise invalid
    row.revoked_at = now
    tokens = _issue(db, request, user, family_id=row.family_id)
    db.commit()
    return tokens


@router.post("/logout", status_code=204)
def logout(body: RefreshIn, request: Request, db: Session = Depends(get_db)):
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha256(body.refresh_token)))
    if row and row.revoked_at is None:
        db.execute(update(RefreshToken).where(RefreshToken.family_id == row.family_id, RefreshToken.revoked_at.is_(None))
                   .values(revoked_at=datetime.now(timezone.utc)))
        audit(db, request, "logout", row.user_id)
        db.commit()
