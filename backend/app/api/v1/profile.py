from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import current_user
from app.models.tables import HealthProfile, User, UserPreference
from app.schemas.api import PreferencesIn, ProfileIn
from app.services.features import age_years, derive_bmi

router = APIRouter(tags=["profile"])


def profile_out(db: Session, user: User) -> dict:
    p = db.get(HealthProfile, user.id) or HealthProfile(user_id=user.id)
    bmi = derive_bmi(db, user.id, p)
    return {
        "content_kind": "measured",
        "email": user.email, "display_name": user.display_name,
        "date_of_birth": p.date_of_birth.isoformat() if p.date_of_birth else None,
        "age": age_years(p.date_of_birth) if p.date_of_birth else None,
        "sex": p.sex, "height_cm": p.height_cm,
        "bmi": {"value": bmi[0], "source": bmi[1]} if bmi else None,
    }


@router.get("/profile")
def get_profile(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return profile_out(db, user)


@router.put("/profile")
def put_profile(body: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(HealthProfile, user.id) or HealthProfile(user_id=user.id)
    db.add(p)
    for field in ("date_of_birth", "sex", "height_cm"):
        if field in body.model_fields_set:
            setattr(p, field, getattr(body, field))
    if "display_name" in body.model_fields_set:
        user.display_name = body.display_name
    db.commit()
    return profile_out(db, user)


@router.get("/preferences")
def get_preferences(user: User = Depends(current_user), db: Session = Depends(get_db)):
    pref = db.get(UserPreference, user.id) or UserPreference(user_id=user.id, locale="en", theme="light", reduced_motion=False)
    return {"locale": pref.locale, "theme": pref.theme, "reduced_motion": pref.reduced_motion}


@router.put("/preferences")
def put_preferences(body: PreferencesIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    pref = db.get(UserPreference, user.id)
    if pref is None:
        pref = UserPreference(user_id=user.id, locale="en", theme="light", reduced_motion=False)
        db.add(pref)
    for field in body.model_fields_set:
        if getattr(body, field) is not None:
            setattr(pref, field, getattr(body, field))
    db.commit()
    return {"locale": pref.locale, "theme": pref.theme, "reduced_motion": pref.reduced_motion}
