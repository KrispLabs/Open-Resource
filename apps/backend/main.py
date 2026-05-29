import os
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, SessionLocal, Base
from models.models import (  # noqa: F401 — import all models so Base.metadata picks them up
    User, Job, Application, CandidateScore,
    OutboundCampaign, OutboundCandidate, ScoringConfig, SystemLog,
)
from models.provider_config import ProviderConfig  # noqa: F401 — register with Base.metadata
from routers.auth import router as auth_router
from routers.jobs import router as jobs_router
from routers.applications import router as applications_router
from routers.scoring import router as scoring_router
from routers.outbound import router as outbound_router
from routers.dev import router as dev_router
from routers.setup import router as setup_router
from routers.files import router as files_router
from middleware import RequestIDMiddleware, SecurityHeadersMiddleware
from seed import seed_database
from config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Ensure uploads directory exists before app starts
os.makedirs(settings.upload_dir, exist_ok=True)


def _ensure_db_indexes() -> None:
    """Create performance indexes on existing tables (CREATE INDEX IF NOT EXISTS is idempotent)."""
    from sqlalchemy import text as _text
    with engine.connect() as conn:
        indexes = [
            "CREATE INDEX IF NOT EXISTS ix_applications_job_id ON applications (job_id)",
            "CREATE INDEX IF NOT EXISTS ix_applications_applicant_id ON applications (applicant_id)",
            "CREATE INDEX IF NOT EXISTS ix_outbound_candidates_campaign_id ON outbound_candidates (campaign_id)",
            "CREATE INDEX IF NOT EXISTS ix_system_logs_created_at ON system_logs (created_at)",
        ]
        for stmt in indexes:
            conn.execute(_text(stmt))
        conn.commit()


def _recover_orphan_campaigns() -> None:
    """Mark campaigns stuck in 'running' for >1 hour as 'failed' on startup."""
    from datetime import timedelta
    from models.models import OutboundCampaign
    cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
    db = SessionLocal()
    try:
        stuck = db.query(OutboundCampaign).filter(
            OutboundCampaign.status == "running",
            OutboundCampaign.created_at < cutoff,
        ).all()
        for campaign in stuck:
            campaign.status = "failed"
            logger.warning("Recovered orphan campaign %s (was stuck running)", campaign.id)
        if stuck:
            db.commit()
    except Exception as exc:
        logger.error("Orphan campaign recovery failed: %s", exc)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up — creating tables and seeding...")
    Base.metadata.create_all(bind=engine)

    import os as _os
    _DEFAULT_JWT = "dev-secret-change-in-prod"
    _DEFAULT_SERVER = "dev-secret-change-in-prod-32chars!"
    _is_prod = _os.environ.get("APP_ENV", "development").lower() == "production"
    if _is_prod:
        if settings.jwt_secret == _DEFAULT_JWT:
            raise RuntimeError("FATAL: JWT_SECRET uses the insecure default. Set a strong secret in production.")
        if settings.server_secret_key == _DEFAULT_SERVER:
            raise RuntimeError("FATAL: SERVER_SECRET_KEY uses the insecure default. Set a strong secret in production.")
    elif settings.jwt_secret == _DEFAULT_JWT or settings.server_secret_key == _DEFAULT_SERVER:
        logger.warning("Using default secrets — set JWT_SECRET and SERVER_SECRET_KEY before going to production.")

    from services.provider_manager import migrate_env_to_db, check_required_providers
    migrate_env_to_db()
    check_required_providers()
    logger.info("Provider credentials migrated from env.")
    db = SessionLocal()
    try:
        seed_database(db)
        logger.info("Database ready.")
    finally:
        db.close()
    _ensure_db_indexes()
    _recover_orphan_campaigns()
    logger.info("Startup checks complete.")
    yield
    logger.info("Shutting down.")


app = FastAPI(title="Open Resource API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.frontend_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestIDMiddleware)

app.include_router(files_router)
app.include_router(auth_router)
app.include_router(jobs_router)
app.include_router(applications_router)
app.include_router(scoring_router)
app.include_router(setup_router, prefix="/api")
app.include_router(outbound_router, prefix="/api")
app.include_router(dev_router, prefix="/api")


@app.get("/health")
def health():
    from sqlalchemy import text as _text
    from services.provider_manager import provider_manager
    try:
        db = SessionLocal()
        db.execute(_text("SELECT 1"))
        db.close()
        db_ok = True
    except Exception:
        db_ok = False
    featherless_cfg = provider_manager.get("featherless")
    featherless_ok = bool(featherless_cfg.get("api_key"))
    github_ok = bool(
        provider_manager.get("github").get("token") or
        provider_manager.get("brightdata").get("api_key")
    )
    return {
        "status": "ok" if db_ok else "degraded",
        "db": "connected" if db_ok else "error",
        "featherless": "ready" if featherless_ok else "missing_api_key",
        "github_sourcing": "ready" if github_ok else "missing_token",
    }
