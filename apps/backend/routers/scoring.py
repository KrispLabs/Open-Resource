import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy import nulls_last, asc
from sqlalchemy.orm import Session

from database import get_db, SessionLocal
from models.models import Job, Application, CandidateScore, User
from schemas.scoring import CloseJobRequest
from deps import require_hr, get_current_user
from services.scorer import score_candidate
from config import settings
from utils.sse import format_sse

router = APIRouter(tags=["scoring"])

MAX_CONCURRENT = 5  # max parallel AI scoring calls


def _sse(event_type: str, payload: dict) -> str:
    return format_sse(event_type, {"type": event_type, "payload": payload})


# ── Close job (status only) ───────────────────────────────────────────────────

@router.post("/jobs/{job_id}/close")
def close_job(
    job_id: str,
    body: CloseJobRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")
    if job.status != "active":
        raise HTTPException(status_code=400, detail="Only active jobs can be closed")

    job.status = "closed"
    job.closed_at = datetime.now(timezone.utc)
    if body.shortlist_cutoff is not None:
        job.shortlist_cutoff = body.shortlist_cutoff
    db.commit()
    db.refresh(job)
    return {"id": job.id, "status": job.status, "shortlist_cutoff": job.shortlist_cutoff}


# ── Trigger scoring (separate from close) ────────────────────────────────────

@router.post("/jobs/{job_id}/score")
def trigger_scoring(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")
    if job.status != "closed":
        raise HTTPException(status_code=400, detail="Job must be closed before scoring. Call /close first.")

    return {"message": "Scoring started", "job_id": job_id}


# ── SSE scoring stream ────────────────────────────────────────────────────────

@router.get("/jobs/{job_id}/stream")
async def scoring_stream(
    job_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ("hr", "dev"):
        raise HTTPException(status_code=403, detail="HR or Dev access required")

    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if current_user.role == "hr" and job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")
    if job.status != "closed":
        raise HTTPException(status_code=400, detail="Job must be closed before scoring")

    applications = (
        db.query(Application)
        .filter(Application.job_id == job_id)
        .all()
    )

    async def event_stream():
        # Use a fresh DB session for the async generator (can't share sessions across async context)
        async_db = SessionLocal()
        try:
            total = len(applications)
            yield _sse("session_start", {"total": total})
            yield _sse("step", {"text": "Loading job requirements and candidate resumes..."})

            if total == 0:
                yield _sse("session_done", {"shortlisted": 0, "not_shortlisted": 0, "reviewing": 0})
                return

            yield _sse("step", {"text": f"Scoring {total} candidate{'s' if total != 1 else ''}..."})

            semaphore = asyncio.Semaphore(MAX_CONCURRENT)
            queue: asyncio.Queue = asyncio.Queue()

            async def score_and_enqueue(app: Application, index: int):
                async with semaphore:
                    if await request.is_disconnected():
                        return
                    applicant = async_db.query(User).filter(User.id == app.applicant_id).first()
                    name = applicant.name if applicant else "Candidate"
                    await queue.put(("candidate_start", name, index, None))
                    try:
                        score = await score_candidate(
                            application=app,
                            job_description=job.description,
                            job_title=job.title,
                            scoring_weights=job.scoring_weights or {},
                            upload_dir=settings.upload_dir,
                            db=async_db,
                        )
                        await queue.put(("candidate_done", name, index, score))
                    except Exception as exc:
                        await queue.put(("candidate_error", name, index, str(exc)))

            tasks = [
                asyncio.create_task(score_and_enqueue(app, i + 1))
                for i, app in enumerate(applications)
            ]

            completed = 0
            while completed < total:
                if await request.is_disconnected():
                    for t in tasks:
                        t.cancel()
                    return

                try:
                    event_type, name, index, payload = await asyncio.wait_for(
                        queue.get(), timeout=120.0
                    )
                except asyncio.TimeoutError:
                    yield _sse("step", {"text": "Still processing..."})
                    continue

                if event_type == "candidate_start":
                    yield _sse("candidate_start", {"name": name, "index": index})
                elif event_type == "candidate_done":
                    score = payload
                    yield _sse("candidate_done", {
                        "name": name,
                        "score": score.weighted_total,
                        "verdict": score.verdict,
                        "index": index,
                    })
                    completed += 1
                elif event_type == "candidate_error":
                    yield _sse("candidate_done", {
                        "name": name,
                        "score": 0,
                        "verdict": "rejected",
                        "index": index,
                        "error": str(payload),
                    })
                    completed += 1

            await asyncio.gather(*tasks, return_exceptions=True)

            # After all scored: assign ranks + apply shortlist_cutoff
            yield _sse("step", {"text": "Finalising rankings and shortlist..."})

            scored_apps = (
                async_db.query(Application)
                .join(CandidateScore, Application.id == CandidateScore.application_id)
                .filter(Application.job_id == job_id)
                .order_by(CandidateScore.weighted_total.desc())
                .all()
            )

            job_row = async_db.query(Job).filter(Job.id == job_id).first()
            cutoff = job_row.shortlist_cutoff if job_row else None

            shortlisted_count = 0
            reviewing_count = 0
            rejected_count = 0

            for rank, app in enumerate(scored_apps, start=1):
                app.rank = rank
                score_row = async_db.query(CandidateScore).filter(
                    CandidateScore.application_id == app.id
                ).first()
                if score_row:
                    if cutoff and rank <= cutoff:
                        app.status = "shortlisted"
                        score_row.verdict = "shortlisted"
                        shortlisted_count += 1
                    elif score_row.verdict == "reviewing":
                        app.status = "reviewing"
                        reviewing_count += 1
                    else:
                        app.status = score_row.verdict
                        if score_row.verdict == "rejected":
                            rejected_count += 1
                        else:
                            shortlisted_count += 1

            async_db.commit()

            yield _sse("session_done", {
                "shortlisted": shortlisted_count,
                "not_shortlisted": rejected_count,
                "reviewing": reviewing_count,
            })

        finally:
            async_db.close()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── Rankings endpoint ─────────────────────────────────────────────────────────

@router.get("/jobs/{job_id}/rankings")
def get_rankings(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ("hr", "dev"):
        raise HTTPException(status_code=403, detail="HR or Dev access required")

    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if current_user.role == "hr" and job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")

    applications = (
        db.query(Application)
        .filter(Application.job_id == job_id)
        .order_by(nulls_last(asc(Application.rank)), Application.submitted_at.asc())
        .all()
    )

    results = []
    for app in applications:
        score = db.query(CandidateScore).filter(
            CandidateScore.application_id == app.id
        ).first()
        applicant = db.query(User).filter(User.id == app.applicant_id).first()
        entry = {
            "application_id": app.id,
            "rank": app.rank,
            "applicant_name": applicant.name if applicant else "Unknown",
            "applicant_email": applicant.email if applicant else "",
            "resume_filename": app.resume_filename,
            "cover_note": app.cover_note,
            "status": app.status,
            "submitted_at": app.submitted_at,
            "candidate_scores": None,
        }
        if score:
            entry["candidate_scores"] = {
                "id": score.id,
                "technical_score": score.technical_score,
                "experience_score": score.experience_score,
                "project_score": score.project_score,
                "education_score": score.education_score,
                "communication_score": score.communication_score,
                "weighted_total": score.weighted_total,
                "verdict": score.verdict,
                "reasoning": score.reasoning,
                "strengths": score.strengths,
                "gaps": score.gaps,
                "matched_skills": score.matched_skills,
                "missing_skills": score.missing_skills,
                "interview_questions": score.interview_questions,
                "applicant_feedback": score.applicant_feedback,
                "scored_at": score.scored_at,
            }
        results.append(entry)

    return results
