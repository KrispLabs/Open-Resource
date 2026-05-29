from datetime import datetime, timezone, date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from deps import require_dev
from models.models import (
    Job, Application, CandidateScore, ScoringConfig,
    SystemLog, User,
)

router = APIRouter(prefix="/dev", tags=["dev"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class DevStats(BaseModel):
    total_jobs: int
    active_jobs: int
    closed_jobs: int
    total_applications: int
    total_scored: int
    claude_calls_today: int
    claude_tokens_today: int
    github_calls_today: int
    avg_latency_ms: float
    error_rate_today: float
    shortlisted_total: int
    not_shortlisted_total: int


class SystemLogResponse(BaseModel):
    id: str
    event_type: str
    job_id: Optional[str]
    api_provider: str
    tokens_used: Optional[int]
    latency_ms: int
    status: str
    error_message: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class LogsResponse(BaseModel):
    logs: list[SystemLogResponse]
    total: int


class ScoringWeights(BaseModel):
    technical_skills: int
    experience: int
    projects: int
    education: int
    communication: int


class ScoringConfigResponse(BaseModel):
    id: str
    label: str
    weights: ScoringWeights
    is_default: bool
    updated_at: datetime

    model_config = {"from_attributes": True}


class ScoringConfigUpdateRequest(BaseModel):
    weights: ScoringWeights


class DevJobResponse(BaseModel):
    id: str
    title: str
    status: str
    creator_name: str
    creator_email: str
    application_count: int
    scored_count: int
    scoring_weights: dict
    created_at: datetime
    location: Optional[str]
    job_type: str


class DayUsage(BaseModel):
    date: str
    claude_calls: int
    claude_tokens: int
    github_calls: int
    errors: int


# ── GET /dev/stats ─────────────────────────────────────────────────────────────

@router.get("/stats", response_model=DevStats)
def get_stats(
    db: Session = Depends(get_db),
    _: User = Depends(require_dev),
):
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    total_jobs = db.query(func.count(Job.id)).scalar() or 0
    active_jobs = db.query(func.count(Job.id)).filter(Job.status == "active").scalar() or 0
    closed_jobs = db.query(func.count(Job.id)).filter(Job.status == "closed").scalar() or 0
    total_applications = db.query(func.count(Application.id)).scalar() or 0
    total_scored = db.query(func.count(CandidateScore.id)).scalar() or 0

    shortlisted_total = (
        db.query(func.count(Application.id))
        .filter(Application.status == "shortlisted")
        .scalar() or 0
    )
    not_shortlisted_total = total_applications - shortlisted_total

    # Today's logs
    today_logs = db.query(SystemLog).filter(SystemLog.created_at >= today_start).all()

    claude_today = [l for l in today_logs if l.api_provider in ("featherless", "claude", "anthropic")]
    github_today = [l for l in today_logs if l.api_provider == "github"]
    error_today = [l for l in today_logs if l.status == "error"]

    claude_calls_today = len(claude_today)
    claude_tokens_today = sum((l.tokens_used or 0) for l in claude_today)
    github_calls_today = len(github_today)

    avg_latency_ms: float = 0.0
    if today_logs:
        avg_latency_ms = sum(l.latency_ms for l in today_logs) / len(today_logs)

    error_rate_today: float = 0.0
    if today_logs:
        error_rate_today = round((len(error_today) / len(today_logs)) * 100, 1)

    return DevStats(
        total_jobs=total_jobs,
        active_jobs=active_jobs,
        closed_jobs=closed_jobs,
        total_applications=total_applications,
        total_scored=total_scored,
        claude_calls_today=claude_calls_today,
        claude_tokens_today=claude_tokens_today,
        github_calls_today=github_calls_today,
        avg_latency_ms=round(avg_latency_ms, 1),
        error_rate_today=error_rate_today,
        shortlisted_total=shortlisted_total,
        not_shortlisted_total=not_shortlisted_total,
    )


# ── GET /dev/logs ──────────────────────────────────────────────────────────────

@router.get("/logs", response_model=LogsResponse)
def get_logs(
    event_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    api_provider: Optional[str] = Query(None),
    job_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_dev),
):
    q = db.query(SystemLog)

    if event_type:
        q = q.filter(SystemLog.event_type == event_type)
    if status:
        q = q.filter(SystemLog.status == status)
    if api_provider:
        q = q.filter(SystemLog.api_provider == api_provider)
    if job_id:
        q = q.filter(SystemLog.job_id == job_id)

    total = q.count()
    logs = q.order_by(SystemLog.created_at.desc()).offset(offset).limit(limit).all()

    return LogsResponse(
        logs=[SystemLogResponse.model_validate(l) for l in logs],
        total=total,
    )


# ── GET /dev/jobs ──────────────────────────────────────────────────────────────

@router.get("/jobs", response_model=list[DevJobResponse])
def get_all_jobs(
    db: Session = Depends(get_db),
    _: User = Depends(require_dev),
):
    jobs = db.query(Job).order_by(Job.created_at.desc()).all()
    result = []
    for job in jobs:
        creator = db.query(User).filter(User.id == job.created_by).first()
        app_count = db.query(func.count(Application.id)).filter(Application.job_id == job.id).scalar() or 0
        scored_count = (
            db.query(func.count(CandidateScore.id))
            .join(Application, CandidateScore.application_id == Application.id)
            .filter(Application.job_id == job.id)
            .scalar() or 0
        )
        result.append(DevJobResponse(
            id=job.id,
            title=job.title,
            status=job.status,
            creator_name=creator.name if creator else "Unknown",
            creator_email=creator.email if creator else "",
            application_count=app_count,
            scored_count=scored_count,
            scoring_weights=job.scoring_weights or {},
            created_at=job.created_at,
            location=job.location,
            job_type=job.job_type,
        ))
    return result


# ── GET /dev/scoring-config ────────────────────────────────────────────────────

@router.get("/scoring-config", response_model=ScoringConfigResponse)
def get_scoring_config(
    db: Session = Depends(get_db),
    _: User = Depends(require_dev),
):
    config = db.query(ScoringConfig).filter(ScoringConfig.is_default == True).first()  # noqa: E712
    if not config:
        raise HTTPException(status_code=404, detail="Default scoring config not found")
    return ScoringConfigResponse.model_validate(config)


# ── PATCH /dev/scoring-config ──────────────────────────────────────────────────

@router.patch("/scoring-config", response_model=ScoringConfigResponse)
def update_scoring_config(
    body: ScoringConfigUpdateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_dev),
):
    config = db.query(ScoringConfig).filter(ScoringConfig.is_default == True).first()  # noqa: E712
    if not config:
        raise HTTPException(status_code=404, detail="Default scoring config not found")

    total = sum(body.weights.model_dump().values())
    if total != 100:
        raise HTTPException(status_code=422, detail=f"Weights must sum to 100, got {total}")

    config.weights = body.weights.model_dump()
    config.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(config)
    return ScoringConfigResponse.model_validate(config)


# ── GET /dev/api-usage ─────────────────────────────────────────────────────────

@router.get("/api-usage", response_model=list[DayUsage])
def get_api_usage(
    db: Session = Depends(get_db),
    _: User = Depends(require_dev),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=14)

    logs = db.query(SystemLog).filter(SystemLog.created_at >= cutoff).all()

    # Aggregate by date
    by_date: dict[str, DayUsage] = {}
    for i in range(14):
        d = (date.today() - timedelta(days=13 - i)).isoformat()
        by_date[d] = DayUsage(date=d, claude_calls=0, claude_tokens=0, github_calls=0, errors=0)

    for log in logs:
        d_key = log.created_at.date().isoformat()
        if d_key not in by_date:
            continue
        entry = by_date[d_key]
        if log.api_provider in ("featherless", "claude", "anthropic"):
            entry.claude_calls += 1
            entry.claude_tokens += log.tokens_used or 0
        elif log.api_provider == "github":
            entry.github_calls += 1
        if log.status == "error":
            entry.errors += 1

    return list(by_date.values())
