import asyncio
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
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
_log = logging.getLogger(__name__)

MAX_CONCURRENT = 5  # max parallel AI scoring calls
_SSE_KEEPALIVE_INTERVAL = 25.0   # seconds between SSE comment pings
_SSE_STEP_THRESHOLD = 3          # emit "Still processing..." after this many keepalives with no progress

_scoring_tasks: set[asyncio.Task] = set()


def _sse(event_type: str, payload: dict) -> str:
    return format_sse(event_type, {"type": event_type, "payload": payload})


# ── Background scoring task ───────────────────────────────────────────────────

async def _run_scoring_background(job_id: str) -> None:
    """
    Score all applications for a just-closed job.
    Runs in a background asyncio task so /close returns immediately.
    Shortlists based on the AI verdict (weighted_total >= 70 → shortlisted,
    <= 45 → rejected, otherwise reviewing) — no rank cutoff required.
    """
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            return
        applications = db.query(Application).filter(Application.job_id == job_id).all()
        if not applications:
            return

        # Capture job primitives before fanning out — concurrent tasks must not
        # share the request/parent session (SQLAlchemy Sessions are not safe for
        # concurrent use; interleaved commits corrupt each other's unit of work).
        job_description = job.description
        job_title = job.title
        scoring_weights = job.scoring_weights or {}
        app_ids = [a.id for a in applications]

        semaphore = asyncio.Semaphore(MAX_CONCURRENT)

        async def _score_one(app_id: str) -> None:
            async with semaphore:
                # Each task owns an isolated session for its full lifecycle.
                task_db = SessionLocal()
                try:
                    if task_db.query(CandidateScore).filter(
                        CandidateScore.application_id == app_id
                    ).first():
                        return  # already scored (e.g. SSE stream opened simultaneously)
                    app = task_db.query(Application).filter(Application.id == app_id).first()
                    if not app:
                        return
                    await score_candidate(
                        application=app,
                        job_description=job_description,
                        job_title=job_title,
                        scoring_weights=scoring_weights,
                        upload_dir=settings.upload_dir,
                        db=task_db,
                    )
                except Exception as exc:
                    _log.warning(
                        "[bg_scoring] job=%s app=%s failed: %s", job_id, app_id, exc
                    )
                finally:
                    task_db.close()

        await asyncio.gather(*[_score_one(aid) for aid in app_ids], return_exceptions=True)

        # Assign ranks and shortlist purely by AI verdict — no cutoff needed
        scored_apps = (
            db.query(Application)
            .join(CandidateScore, Application.id == CandidateScore.application_id)
            .filter(Application.job_id == job_id)
            .order_by(CandidateScore.weighted_total.desc())
            .all()
        )
        for rank, app in enumerate(scored_apps, start=1):
            app.rank = rank
            score_row = db.query(CandidateScore).filter(
                CandidateScore.application_id == app.id
            ).first()
            if score_row:
                app.status = score_row.verdict  # shortlisted / reviewing / rejected
        db.commit()
        _log.info("[bg_scoring] job=%s done: %d ranked", job_id, len(scored_apps))

    except Exception as exc:
        _log.error("[bg_scoring] job=%s error: %s", job_id, exc)
    finally:
        db.close()


# ── Close job + auto-start scoring ───────────────────────────────────────────

@router.post("/jobs/{job_id}/close")
async def close_job(
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
    db.commit()
    db.refresh(job)

    # AI scoring is NEVER auto-started. Closing applications and running scoring
    # are two distinct, manually-triggered recruiter actions (the platform assists,
    # it does not decide). HR explicitly starts scoring via POST /jobs/{id}/score
    # or by opening the scoring stream. We only report whether scoring *can* run.
    from services.provider_manager import provider_manager
    featherless_key = (
        provider_manager.get("featherless").get("api_key") or settings.featherlessai_api_key
    )
    scoring_status = "ready_to_score" if featherless_key else "scoring_pending_api_key"

    return {
        "id": job.id,
        "status": job.status,
        "scoring_status": scoring_status,
    }


# ── Manual re-score trigger (still useful for re-running) ────────────────────

@router.post("/jobs/{job_id}/score")
async def trigger_scoring(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")
    if job.status in ("hired", "archived"):
        raise HTTPException(status_code=400, detail="Cannot score a hired or archived job")
    if job.status not in ("closed", "sourcing", "interviewing"):
        raise HTTPException(status_code=400, detail="Job must be closed before scoring. Call /close first.")

    from services.provider_manager import provider_manager
    from config import settings as _settings
    featherless_key = provider_manager.get("featherless").get("api_key") or _settings.featherlessai_api_key
    if not featherless_key:
        raise HTTPException(
            status_code=503,
            detail=(
                "Featherless AI is not configured — cannot score candidates. "
                "Set FEATHERLESSAI_API_KEY in your .env and restart, "
                "or configure via the Dev portal at /api/providers/configure."
            ),
        )

    # Clear stale scores so the re-run sees fresh candidates (not leftover 0.0 failures)
    app_ids = [
        a.id for a in db.query(Application).filter(Application.job_id == job_id).all()
    ]
    if app_ids:
        db.query(CandidateScore).filter(
            CandidateScore.application_id.in_(app_ids)
        ).delete(synchronize_session=False)
        db.query(Application).filter(
            Application.id.in_(app_ids)
        ).update({"rank": None, "status": "pending"}, synchronize_session=False)
        db.commit()

    task = asyncio.create_task(_run_scoring_background(job_id))
    _scoring_tasks.add(task)
    task.add_done_callback(_scoring_tasks.discard)
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
    if job.status in ("hired", "archived"):
        raise HTTPException(status_code=400, detail="Cannot score a hired or archived job")
    if job.status not in ("closed", "sourcing", "interviewing"):
        raise HTTPException(status_code=400, detail="Job must be closed before scoring")

    applications = (
        db.query(Application)
        .filter(Application.job_id == job_id)
        .all()
    )

    # Capture primitives while the request session is alive — the generator runs
    # after this function returns (when the request-scoped `db` may be closed) and
    # concurrent tasks must never share a single session.
    job_description = job.description
    job_title = job.title
    job_weights = job.scoring_weights or {}

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

            # Preload applicant names to avoid N+1 inside concurrent tasks
            applicant_ids = [app.applicant_id for app in applications]
            applicants_by_id = {
                u.id: u.name for u in async_db.query(User).filter(User.id.in_(applicant_ids)).all()
            }
            name_by_app = {
                app.applicant_id: applicants_by_id.get(app.applicant_id, "Candidate")
                for app in applications
            }
            # (app_id, applicant_name) pairs — only primitives cross into the tasks.
            app_meta = [
                (app.id, name_by_app.get(app.applicant_id, "Candidate"))
                for app in applications
            ]

            async def score_and_enqueue(app_id: str, name: str, index: int):
                async with semaphore:
                    if await request.is_disconnected():
                        return
                    await queue.put(("candidate_start", name, index, None))

                    # Isolated session per task — never share async_db across
                    # concurrent coroutines. Only plain dicts go on the queue so
                    # the consumer never touches a detached/closed-session object.
                    task_db = SessionLocal()
                    try:
                        existing = task_db.query(CandidateScore).filter(
                            CandidateScore.application_id == app_id
                        ).first()
                        if existing:
                            await queue.put((
                                "candidate_done", name, index,
                                {"weighted_total": existing.weighted_total, "verdict": existing.verdict},
                            ))
                            return

                        app = task_db.query(Application).filter(
                            Application.id == app_id
                        ).first()
                        if not app:
                            await queue.put(("candidate_error", name, index, "Application not found"))
                            return

                        score = await score_candidate(
                            application=app,
                            job_description=job_description,
                            job_title=job_title,
                            scoring_weights=job_weights,
                            upload_dir=settings.upload_dir,
                            db=task_db,
                        )
                        await queue.put((
                            "candidate_done", name, index,
                            {"weighted_total": score.weighted_total, "verdict": score.verdict},
                        ))
                    except Exception as exc:
                        # Race: background task may have just finished — use its score
                        fallback = task_db.query(CandidateScore).filter(
                            CandidateScore.application_id == app_id
                        ).first()
                        if fallback:
                            await queue.put((
                                "candidate_done", name, index,
                                {"weighted_total": fallback.weighted_total, "verdict": fallback.verdict},
                            ))
                        else:
                            await queue.put(("candidate_error", name, index, str(exc)))
                    finally:
                        task_db.close()

            tasks = [
                asyncio.create_task(score_and_enqueue(aid, name, i + 1))
                for i, (aid, name) in enumerate(app_meta)
            ]

            completed = 0
            idle_ticks = 0  # keepalive cycles with no candidate progress
            while completed < total:
                if await request.is_disconnected():
                    for t in tasks:
                        t.cancel()
                    return

                try:
                    event_type, name, index, payload = await asyncio.wait_for(
                        queue.get(), timeout=_SSE_KEEPALIVE_INTERVAL
                    )
                    idle_ticks = 0
                except asyncio.TimeoutError:
                    # Send SSE comment to prevent proxy/load-balancer from closing idle connection
                    yield ": keepalive\n\n"
                    idle_ticks += 1
                    if idle_ticks >= _SSE_STEP_THRESHOLD:
                        yield _sse("step", {"text": "Still processing..."})
                        idle_ticks = 0
                    continue

                if event_type == "candidate_start":
                    yield _sse("candidate_start", {"name": name, "index": index})
                elif event_type == "candidate_done":
                    yield _sse("candidate_done", {
                        "name": name,
                        "score": payload["weighted_total"],
                        "verdict": payload["verdict"],
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

            # After all scored: assign ranks + shortlist by AI verdict (no cutoff needed)
            yield _sse("step", {"text": "Finalising rankings and shortlist..."})

            scored_apps = (
                async_db.query(Application)
                .join(CandidateScore, Application.id == CandidateScore.application_id)
                .filter(Application.job_id == job_id)
                .order_by(CandidateScore.weighted_total.desc())
                .all()
            )

            shortlisted_count = 0
            reviewing_count = 0
            rejected_count = 0

            for rank, app in enumerate(scored_apps, start=1):
                app.rank = rank
                score_row = async_db.query(CandidateScore).filter(
                    CandidateScore.application_id == app.id
                ).first()
                if score_row:
                    app.status = score_row.verdict  # shortlisted / reviewing / rejected
                    if score_row.verdict == "shortlisted":
                        shortlisted_count += 1
                    elif score_row.verdict == "reviewing":
                        reviewing_count += 1
                    else:
                        rejected_count += 1

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

    # Bulk-fetch scores and applicants to avoid N+1
    app_ids = [a.id for a in applications]
    applicant_ids = [a.applicant_id for a in applications]

    scores_by_app = {
        s.application_id: s
        for s in db.query(CandidateScore).filter(CandidateScore.application_id.in_(app_ids)).all()
    }
    applicants_by_id = {
        u.id: u
        for u in db.query(User).filter(User.id.in_(applicant_ids)).all()
    }

    results = []
    for app in applications:
        score = scores_by_app.get(app.id)
        applicant = applicants_by_id.get(app.applicant_id)
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
