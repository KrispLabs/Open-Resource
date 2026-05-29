import json
import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from models.models import Job, Application, CandidateScore, User, OutboundCampaign, OutboundCandidate
from schemas.job import (
    JobCreateRequest, JobUpdateRequest, WeightsUpdateRequest,
    JobResponse, JobListResponse,
    ArchiveJobRequest, HireJobRequest, ReopenJobRequest, MoveToInterviewingRequest,
)
from deps import get_current_user, get_optional_user, require_hr
from services.jd_analyzer import analyze_jd
from services.provider_manager import provider_manager
from config import settings

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _job_to_response(job: Job, db: Session) -> JobResponse:
    count = db.query(Application).filter(Application.job_id == job.id).count()
    data = JobResponse.model_validate(job)
    data.application_count = count
    return data


def _job_to_list_response(job: Job, db: Session) -> JobListResponse:
    count = db.query(Application).filter(Application.job_id == job.id).count()
    data = JobListResponse.model_validate(job)
    data.application_count = count
    return data


# ── List jobs ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[JobListResponse])
def list_jobs(
    status: str | None = None,
    include_archived: bool = False,
    db: Session = Depends(get_db),
    current_user=Depends(get_optional_user),
):
    q = db.query(Job)
    if current_user is None:
        # Unauthenticated — only active jobs
        q = q.filter(Job.status == "active")
    elif current_user.role == "hr":
        q = q.filter(Job.created_by == current_user.id)
        if not include_archived:
            q = q.filter(Job.status != "archived")
    elif current_user.role == "applicant":
        q = q.filter(Job.status == "active")
    if status:
        q = q.filter(Job.status == status)
    jobs = q.order_by(Job.created_at.desc()).all()
    return [_job_to_list_response(j, db) for j in jobs]


# ── Create job ─────────────────────────────────────────────────────────────────

@router.post("", response_model=JobResponse, status_code=status.HTTP_201_CREATED)
def create_job(
    body: JobCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    job = Job(
        created_by=current_user.id,
        title=body.title,
        description=body.description,
        location=body.location,
        job_type=body.job_type,
        application_deadline=body.application_deadline,
        status="draft",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return _job_to_response(job, db)


# ── Get job ───────────────────────────────────────────────────────────────────

@router.get("/{job_id}", response_model=JobResponse)
def get_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_optional_user),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if current_user is None:
        if job.status != "active":
            raise HTTPException(status_code=404, detail="Job not found")
    elif current_user.role == "hr" and job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")
    elif current_user.role == "applicant" and job.status != "active":
        raise HTTPException(status_code=403, detail="Job is not available")
    return _job_to_response(job, db)


# ── Get job weights ───────────────────────────────────────────────────────────

@router.get("/{job_id}/weights")
def get_job_weights(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")

    jd_parsed = job.jd_parsed or {}
    proposed_weights = jd_parsed.get("proposed_weights", {})
    weight_reasoning = jd_parsed.get("weight_reasoning", "")

    return {
        "current_weights": job.scoring_weights or {},
        "proposed_weights": proposed_weights,
        "weight_reasoning": weight_reasoning,
    }


# ── Update job ─────────────────────────────────────────────────────────────────

@router.patch("/{job_id}", response_model=JobResponse)
def update_job(
    job_id: str,
    body: JobUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")
    updates = body.model_dump(exclude_none=True)

    # shortlist_cutoff can be updated at any job status
    if set(updates.keys()) - {"shortlist_cutoff"} and job.status not in ("draft",):
        raise HTTPException(status_code=400, detail="Cannot edit a published or closed job")

    for field, value in updates.items():
        setattr(job, field, value)
    db.commit()
    db.refresh(job)
    return _job_to_response(job, db)


# ── Analyze JD ────────────────────────────────────────────────────────────────

@router.post("/{job_id}/analyze", response_model=JobResponse)
async def analyze_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")

    # Pre-flight: confirm Featherless is configured before entering the AI pipeline
    featherless_key = (
        provider_manager.get("featherless").get("api_key")
        or settings.featherlessai_api_key
    )
    if not featherless_key:
        _log.error(
            "JD analyze called for job %s but FEATHERLESSAI_API_KEY is not configured",
            job_id,
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "AI provider not configured — set FEATHERLESSAI_API_KEY in .env and restart, "
                "or configure via the Dev portal (Settings → Providers)."
            ),
        )

    try:
        parsed = await analyze_jd(db, job.id, job.description, current_user.id)
    except httpx.TimeoutException:
        _log.error("JD analysis timeout for job %s", job_id)
        raise HTTPException(
            status_code=504,
            detail="AI provider timed out (60 s limit). Check your Featherless quota and retry.",
        )
    except httpx.HTTPStatusError as exc:
        _log.error(
            "JD analysis HTTP error for job %s: status=%d body=%r",
            job_id, exc.response.status_code, exc.response.text[:300],
        )
        raise HTTPException(
            status_code=502,
            detail=(
                f"AI provider returned HTTP {exc.response.status_code}: "
                f"{exc.response.text[:300]}"
            ),
        )
    except json.JSONDecodeError as exc:
        _log.error("JD analysis JSON parse error for job %s: %s", job_id, exc)
        raise HTTPException(
            status_code=502,
            detail=f"AI response was not valid JSON: {exc}",
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        _log.exception("Unexpected error during JD analysis for job %s", job_id)
        raise HTTPException(
            status_code=502,
            detail=f"AI analysis failed ({type(exc).__name__}): {exc}",
        )

    job.jd_parsed = parsed
    # Pre-fill scoring_weights from AI proposal
    job.scoring_weights = parsed["proposed_weights"]
    db.commit()
    db.refresh(job)
    return _job_to_response(job, db)


# ── Update weights + publish job ──────────────────────────────────────────────

@router.post("/{job_id}/publish", response_model=JobResponse)
def publish_job(
    job_id: str,
    body: WeightsUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")
    if job.status != "draft":
        raise HTTPException(status_code=400, detail="Job is already published or closed")

    job.scoring_weights = body.scoring_weights.model_dump()
    job.status = "active"
    db.commit()
    db.refresh(job)
    return _job_to_response(job, db)


# ── Update weights only (without publishing) ──────────────────────────────────

@router.patch("/{job_id}/weights", response_model=JobResponse)
def update_weights(
    job_id: str,
    body: WeightsUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")

    job.scoring_weights = body.scoring_weights.model_dump()
    db.commit()
    db.refresh(job)
    return _job_to_response(job, db)


# ── Archive job ────────────────────────────────────────────────────────────────

@router.post("/{job_id}/archive", response_model=JobResponse)
def archive_job(
    job_id: str,
    body: ArchiveJobRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")
    if job.status == "archived":
        raise HTTPException(status_code=400, detail="Job is already archived")
    if job.status == "active":
        raise HTTPException(status_code=400, detail="Close applications before archiving")

    job.status = "archived"
    db.commit()
    db.refresh(job)
    return _job_to_response(job, db)


# ── Mark job as hired ──────────────────────────────────────────────────────────

@router.post("/{job_id}/hire", response_model=JobResponse)
def hire_job(
    job_id: str,
    body: HireJobRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")
    if job.status not in ("closed", "sourcing", "interviewing"):
        raise HTTPException(
            status_code=400,
            detail="Job must be closed, sourcing, or in interviewing stage to mark as hired",
        )

    job.status = "hired"
    job.hired_at = datetime.now(timezone.utc)
    job.hiring_summary = {"selected_count": body.selected_count, "notes": body.notes}
    db.commit()
    db.refresh(job)
    return _job_to_response(job, db)


# ── Reopen job ─────────────────────────────────────────────────────────────────

@router.post("/{job_id}/reopen", response_model=JobResponse)
def reopen_job(
    job_id: str,
    body: ReopenJobRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")
    if job.status not in ("archived", "hired"):
        raise HTTPException(status_code=400, detail="Only archived or hired jobs can be reopened")

    job.status = "draft"
    job.hired_at = None
    job.hiring_summary = None

    if body.reset_scoring:
        applications = db.query(Application).filter(Application.job_id == job_id).all()
        for app in applications:
            score = db.query(CandidateScore).filter(
                CandidateScore.application_id == app.id
            ).first()
            if score:
                db.delete(score)
            app.status = "pending"
            app.rank = None

    db.commit()
    db.refresh(job)
    return _job_to_response(job, db)


# ── Move job to interviewing ───────────────────────────────────────────────────

@router.post("/{job_id}/interviewing", response_model=JobResponse)
def move_to_interviewing(
    job_id: str,
    body: MoveToInterviewingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")
    if job.status not in ("closed", "sourcing"):
        raise HTTPException(
            status_code=400,
            detail="Job must be closed or sourcing to move to interviewing",
        )

    job.status = "interviewing"
    db.commit()
    db.refresh(job)
    return _job_to_response(job, db)


# ── Delete job (hard delete, all related data) ────────────────────────────────

@router.delete("/{job_id}", status_code=204)
def delete_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")

    from models.models import SystemLog

    # Step 1 — NULL-out all SystemLog FK references for this job up front
    # (SystemLog references jobs, applications, AND campaigns; FK is nullable)
    db.query(SystemLog).filter(SystemLog.job_id == job_id).update(
        {"job_id": None, "application_id": None}, synchronize_session=False
    )

    # Step 2 — outbound candidates → campaigns (plus any campaign-only logs)
    campaign_ids = [
        r[0] for r in
        db.query(OutboundCampaign.id).filter(OutboundCampaign.job_id == job_id).all()
    ]
    if campaign_ids:
        db.query(OutboundCandidate).filter(
            OutboundCandidate.campaign_id.in_(campaign_ids)
        ).delete(synchronize_session=False)
        db.query(SystemLog).filter(
            SystemLog.campaign_id.in_(campaign_ids)
        ).update({"campaign_id": None}, synchronize_session=False)
        db.query(OutboundCampaign).filter(
            OutboundCampaign.job_id == job_id
        ).delete(synchronize_session=False)

    # Step 3 — candidate scores → applications
    app_ids = [
        r[0] for r in
        db.query(Application.id).filter(Application.job_id == job_id).all()
    ]
    if app_ids:
        db.query(CandidateScore).filter(
            CandidateScore.application_id.in_(app_ids)
        ).delete(synchronize_session=False)
        db.query(Application).filter(
            Application.job_id == job_id
        ).delete(synchronize_session=False)

    # Step 4 — the job itself (bulk SQL; avoids ORM cascade conflicts)
    db.query(Job).filter(Job.id == job_id).delete(synchronize_session=False)
    db.commit()
