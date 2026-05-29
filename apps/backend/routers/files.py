import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from deps import get_current_user
from models.models import Application, Job, User

router = APIRouter(prefix="/files", tags=["files"])
logger = logging.getLogger(__name__)


@router.get("/{job_id}/{filename}")
def serve_resume(
    job_id: str,
    filename: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Serve resume PDFs with role-based access control.
    HR: their own jobs only. Applicant: their own resume only. Dev: all."""
    file_path = Path(settings.upload_dir) / job_id / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    # Prevent path traversal (extra safety beyond Starlette's built-in)
    try:
        file_path.resolve().relative_to(Path(settings.upload_dir).resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    if current_user.role == "applicant":
        app = db.query(Application).filter(
            Application.job_id == job_id,
            Application.applicant_id == current_user.id,
            Application.resume_filename == filename,
        ).first()
        if not app:
            raise HTTPException(status_code=403, detail="Access denied")

    elif current_user.role == "hr":
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job or job.created_by != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied")

    # dev role: full access
    return FileResponse(path=str(file_path), media_type="application/pdf")
