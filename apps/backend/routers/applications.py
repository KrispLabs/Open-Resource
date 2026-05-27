import os
import shutil
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy import nulls_last, asc
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from database import get_db
from models.models import Application, Job, User, CandidateScore
from schemas.application import (
    ApplicationResponse,
    ApplicantApplicationResponse,
    ApplicantScoreView,
    PatchApplicationRequest,
)
from deps import get_current_user, require_hr
from config import settings
from services.pdf_parser import extract_text_from_pdf

router = APIRouter(tags=["applications"])

PDF_MAGIC = b"%PDF"
MAX_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB


def _validate_pdf(file: UploadFile) -> bytes:
    """Read file into memory, check size and PDF magic bytes."""
    content = file.file.read()
    if len(content) > MAX_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Resume must be under 5MB",
        )
    if not content.startswith(PDF_MAGIC):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only PDF files are accepted",
        )
    return content


def _save_resume(content: bytes, job_id: str, application_id: str) -> str:
    upload_dir = Path(settings.upload_dir) / job_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{application_id}.pdf"
    filepath = upload_dir / filename
    filepath.write_bytes(content)
    return filename


def _build_hr_response(app: Application, db: Session) -> ApplicationResponse:
    score = db.query(CandidateScore).filter(
        CandidateScore.application_id == app.id
    ).first()
    return ApplicationResponse(
        id=app.id,
        job_id=app.job_id,
        applicant_id=app.applicant_id,
        applicant_name=app.applicant.name,
        applicant_email=app.applicant.email,
        resume_filename=app.resume_filename,
        resume_text=app.resume_text,
        cover_note=app.cover_note,
        status=app.status,
        rank=app.rank,
        submitted_at=app.submitted_at,
        candidate_scores=score,
    )


def _build_applicant_response(app: Application, db: Session) -> ApplicantApplicationResponse:
    job = db.query(Job).filter(Job.id == app.job_id).first()
    scores = None
    # Only reveal scores after job is closed
    if job and job.status == "closed":
        score = db.query(CandidateScore).filter(
            CandidateScore.application_id == app.id
        ).first()
        if score:
            scores = ApplicantScoreView.model_validate(score)
    return ApplicantApplicationResponse(
        id=app.id,
        job_id=app.job_id,
        job_title=job.title if job else "",
        resume_filename=app.resume_filename,
        cover_note=app.cover_note,
        status=app.status,
        rank=app.rank,
        submitted_at=app.submitted_at,
        scores=scores,
    )


# ── Apply to a job ────────────────────────────────────────────────────────────

@router.post("/jobs/{job_id}/apply", status_code=status.HTTP_201_CREATED)
async def apply_to_job(
    job_id: str,
    resume: UploadFile = File(...),
    cover_note: str = Form(default=""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ("applicant",):
        raise HTTPException(status_code=403, detail="Only applicants can apply to jobs")

    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "active":
        raise HTTPException(status_code=400, detail="This job is not accepting applications")

    # Validate PDF
    content = _validate_pdf(resume)

    # Check cover note length
    if len(cover_note) > 500:
        raise HTTPException(status_code=400, detail="Cover note must be 500 characters or fewer")

    # Create application row first (need the ID for file path)
    app = Application(
        job_id=job_id,
        applicant_id=current_user.id,
        resume_filename="pending",
        cover_note=cover_note,
        status="pending",
    )
    db.add(app)
    try:
        db.flush()  # get app.id without committing
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="You have already applied to this job")

    # Save PDF and extract text
    filename = _save_resume(content, job_id, app.id)
    app.resume_filename = filename
    try:
        resume_path = Path(settings.upload_dir) / job_id / f"{app.id}.pdf"
        app.resume_text = extract_text_from_pdf(resume_path)
    except Exception:
        app.resume_text = None
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # Clean up saved file
        try:
            (Path(settings.upload_dir) / job_id / f"{app.id}.pdf").unlink(missing_ok=True)
        except Exception:
            pass
        raise HTTPException(status_code=409, detail="You have already applied to this job")

    db.refresh(app)
    return _build_applicant_response(app, db)


# ── HR: list applications for a job ──────────────────────────────────────────

@router.get("/jobs/{job_id}/applications", response_model=list[ApplicationResponse])
def list_applications(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")

    apps = (
        db.query(Application)
        .filter(Application.job_id == job_id)
        .order_by(nulls_last(asc(Application.rank)), Application.submitted_at.asc())
        .all()
    )
    return [_build_hr_response(a, db) for a in apps]


# ── Single application detail ─────────────────────────────────────────────────

@router.get("/applications/{application_id}")
def get_application(
    application_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    app = db.query(Application).filter(Application.id == application_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    if current_user.role == "applicant":
        if app.applicant_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not your application")
        return _build_applicant_response(app, db)

    if current_user.role == "hr":
        job = db.query(Job).filter(Job.id == app.job_id).first()
        if job and job.created_by != current_user.id:
            raise HTTPException(status_code=403, detail="Not your job")
        return _build_hr_response(app, db)

    # dev role — full access
    return _build_hr_response(app, db)


# ── HR: override verdict / status on an application ──────────────────────────

VALID_VERDICTS = {"shortlisted", "reviewing", "rejected"}
VALID_STATUSES = {"shortlisted", "reviewing", "rejected", "not_shortlisted"}


@router.patch("/applications/{application_id}", response_model=ApplicationResponse)
def patch_application(
    application_id: str,
    body: PatchApplicationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    app = db.query(Application).filter(Application.id == application_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    job = db.query(Job).filter(Job.id == app.job_id).first()
    if not job or job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")

    if body.verdict is not None:
        if body.verdict not in VALID_VERDICTS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid verdict. Must be one of: {', '.join(sorted(VALID_VERDICTS))}",
            )
        score = db.query(CandidateScore).filter(
            CandidateScore.application_id == app.id
        ).first()
        if score:
            score.verdict = body.verdict

    if body.status is not None:
        if body.status not in VALID_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status. Must be one of: {', '.join(sorted(VALID_STATUSES))}",
            )
        app.status = body.status

    db.commit()
    db.refresh(app)
    return _build_hr_response(app, db)


# ── Applicant: list own applications ─────────────────────────────────────────

@router.get("/applications", response_model=list[ApplicantApplicationResponse])
def list_my_applications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "applicant":
        raise HTTPException(status_code=403, detail="Only applicants can access this endpoint")

    apps = (
        db.query(Application)
        .filter(Application.applicant_id == current_user.id)
        .order_by(Application.submitted_at.desc())
        .all()
    )
    return [_build_applicant_response(a, db) for a in apps]
