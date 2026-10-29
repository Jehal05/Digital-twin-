from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """Configuration comes from HT_* environment variables (or a local .env that is never committed)."""

    model_config = SettingsConfigDict(env_prefix="HT_", env_file=".env", extra="ignore")

    env: str = "dev"                                   # dev | test | prod
    database_url: str = "sqlite:///./healthtwin.db"    # use postgresql+psycopg://... in production
    secret_key: str = ""                               # REQUIRED (>= 32 chars) when env == prod
    access_token_minutes: int = 15
    refresh_token_days: int = 7
    policy_version: str = "2026-10"
    ml_dir: Path = REPO_ROOT / "ml"
    cors_origins: list[str] = ["http://localhost:5173"]
    auth_rate_limit_per_minute: int = 10
    auto_create_tables: bool = True                    # dev/test convenience; production uses Alembic migrations

    def resolved_secret(self) -> str:
        if self.secret_key:
            if len(self.secret_key) < 32:
                raise RuntimeError("HT_SECRET_KEY must be at least 32 characters")
            return self.secret_key
        if self.env == "prod":
            raise RuntimeError("HT_SECRET_KEY must be set in production")
        return _DEV_SECRET


_DEV_SECRET = secrets.token_urlsafe(48)  # random per process: dev tokens stop working on restart, by design


@lru_cache
def get_settings() -> Settings:
    return Settings()
