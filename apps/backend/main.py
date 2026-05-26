import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from database import engine, SessionLocal, Base
from models.models import (  # noqa: F401 — import all models so Base.metadata picks them up
    User, Job, Application, CandidateScore,
    OutboundCampaign, OutboundCandidate, ScoringConfig, SystemLog,
)
from routers.auth import router as auth_router
from routers.jobs import router as jobs_router
from routers.applications import router as applications_router
from routers.scoring import router as scoring_router
from seed import seed_database
from config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Ensure uploads directory exists before app starts
os.makedirs(settings.upload_dir, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up — creating tables and seeding...")
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_database(db)
        logger.info("Database ready.")
    finally:
        db.close()
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

app.mount("/files", StaticFiles(directory=settings.upload_dir), name="files")

app.include_router(auth_router)
app.include_router(jobs_router)
app.include_router(applications_router)
app.include_router(scoring_router)


@app.get("/health")
def health():
    try:
        db = SessionLocal()
        db.execute(__import__("sqlalchemy").text("SELECT 1"))
        db.close()
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        return {"status": "error", "database": str(e)}
