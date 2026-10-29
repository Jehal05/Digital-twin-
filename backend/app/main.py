from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request

from app.api.v1 import auth, explain, imports, insights, measurements, predictions, privacy, profile, reports, scenarios
from app.core.config import Settings, get_settings
from app.core.db import Base, make_engine, make_sessionmaker
from app.core.errors import install_error_handlers
from app.core.security import RateLimiter
from app.models import tables  # noqa: F401  (registers the tables on Base.metadata)
from app.services.ml import ModelRegistry


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    settings.resolved_secret()  # fail fast in production if no secret is configured

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.auto_create_tables:
            Base.metadata.create_all(app.state.engine)
        with app.state.sessionmaker() as db:
            app.state.registry.sync_to_db(db)
        yield
        app.state.engine.dispose()

    app = FastAPI(title="HealthTwin API", version="0.3.0", lifespan=lifespan,
                  docs_url=None if settings.env == "prod" else "/docs", redoc_url=None,
                  openapi_url=None if settings.env == "prod" else "/openapi.json")
    app.state.settings = settings
    app.state.engine = make_engine(settings.database_url)
    app.state.sessionmaker = make_sessionmaker(app.state.engine)
    app.state.registry = ModelRegistry(settings.ml_dir)
    app.state.auth_limiter = RateLimiter(settings.auth_rate_limit_per_minute)
    app.state.share_limiter = RateLimiter(settings.share_rate_limit_per_minute)

    install_error_handlers(app)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False,
                       allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Authorization", "Content-Type"])

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Cache-Control", "no-store")  # responses contain personal health data
        return response

    for router in (auth.router, profile.router, measurements.router, predictions.router, scenarios.router, insights.router,
                   privacy.router, imports.router, explain.router, reports.router):
        app.include_router(router, prefix="/api/v1")

    @app.get("/healthz", tags=["ops"])
    def healthz():
        return {"status": "ok", "models_loaded": sorted(app.state.registry.models)}

    return app

