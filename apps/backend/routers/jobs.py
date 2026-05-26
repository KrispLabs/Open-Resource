from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from models.models import Job, Application, User
from schemas.job import (
    JobCreateRequest, JobUpdateRequest, WeightsUpdateRequest,
    JobResponse, JobListResponse,
)
from deps import get_current_user, require_hr
from services.jd_analyzer import analyze_jd

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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Job)
    if current_user.role == "hr":
        # HR only sees their own jobs
        q = q.filter(Job.created_by == current_user.id)
    elif current_user.role == "applicant":
        # Applicants only see active jobs
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
    current_user: User = Depends(get_current_user),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if current_user.role == "hr" and job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")
    if current_user.role == "applicant" and job.status != "active":
        raise HTTPException(status_code=403, detail="Job is not available")
    return _job_to_response(job, db)


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
    if job.status not in ("draft",):
        raise HTTPException(status_code=400, detail="Cannot edit a published or closed job")

    for field, value in body.model_dump(exclude_none=True).items():
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

    try:
        parsed = await analyze_jd(db, job.id, job.description, current_user.id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {exc}")

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
