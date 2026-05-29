import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from deps import require_hr
from models.models import OutboundCampaign, OutboundCandidate, Job, User
from schemas.outbound import (
    CampaignCreateResponse,
    CampaignResponse,
    OutboundCandidateResponse,
    SendAllResponse,
)
from services.github_service import run_outbound_campaign

router = APIRouter(tags=["outbound"])

_campaign_tasks: set[asyncio.Task] = set()


# ── Create campaign ───────────────────────────────────────────────────────────

@router.post(
    "/jobs/{job_id}/campaigns",
    response_model=CampaignCreateResponse,
    status_code=201,
)
async def create_campaign(
    job_id: str,
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
            detail="Campaigns can only be created for closed, sourcing, or interviewing jobs",
        )

    # Pre-flight: verify Featherless is configured before accepting the campaign
    from services.provider_manager import provider_manager
    from config import settings as _settings
    featherless_key = provider_manager.get("featherless").get("api_key") or _settings.featherlessai_api_key
    if not featherless_key:
        raise HTTPException(
            status_code=503,
            detail=(
                "Featherless AI is not configured — cannot launch campaign. "
                "Set FEATHERLESSAI_API_KEY in your .env and restart, "
                "or configure via the Dev portal at /api/providers/configure."
            ),
        )

    # Pre-flight: a GitHub PAT is required for profile enrichment (Bright Data Dataset API
    # replaced — enrichment always runs through the GitHub REST API now). Bright Data remains
    # optional: it only enhances candidate discovery via SERP.
    github_token = provider_manager.get("github").get("token") or _settings.github_token
    if not github_token:
        raise HTTPException(
            status_code=503,
            detail=(
                "GitHub Personal Access Token required for profile enrichment — cannot launch campaign. "
                "Set GITHUB_TOKEN in your .env and restart, or configure it via the Dev portal."
            ),
        )

    # Pre-flight: job must have been analyzed (jd_parsed required for signal extraction)
    if not job.jd_parsed:
        raise HTTPException(
            status_code=400,
            detail=(
                "Job description has not been analyzed yet. "
                "Run POST /jobs/{job_id}/analyze before launching a sourcing campaign."
            ),
        )

    # Auto-advance: closed → sourcing when first campaign is launched
    if job.status == "closed":
        job.status = "sourcing"

    existing_count = db.query(OutboundCampaign).filter(OutboundCampaign.job_id == job_id).count()

    campaign = OutboundCampaign(
        job_id=job_id,
        created_by=current_user.id,
        status="running",
        run_number=existing_count + 1,
        created_at=datetime.now(timezone.utc),
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)

    # Launch background task with its own DB session — cannot share request's session
    task = asyncio.create_task(run_outbound_campaign(campaign.id))
    _campaign_tasks.add(task)
    task.add_done_callback(_campaign_tasks.discard)

    return CampaignCreateResponse(campaign_id=campaign.id, status="running")


# ── List campaigns for a specific job ────────────────────────────────────────

@router.get("/jobs/{job_id}/campaigns", response_model=list[CampaignResponse])
def list_job_campaigns(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your job")
    campaigns = (
        db.query(OutboundCampaign)
        .filter(
            OutboundCampaign.job_id == job_id,
            OutboundCampaign.created_by == current_user.id,
        )
        .order_by(OutboundCampaign.created_at.desc())
        .all()
    )
    return campaigns


# ── List all campaigns for current HR user ────────────────────────────────────

@router.get("/campaigns", response_model=list[CampaignResponse])
def list_campaigns(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    campaigns = (
        db.query(OutboundCampaign)
        .filter(OutboundCampaign.created_by == current_user.id)
        .order_by(OutboundCampaign.created_at.desc())
        .all()
    )
    return campaigns


# ── Get campaign ──────────────────────────────────────────────────────────────

@router.get("/campaigns/{campaign_id}", response_model=CampaignResponse)
def get_campaign(
    campaign_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    campaign = db.query(OutboundCampaign).filter(OutboundCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your campaign")
    return campaign


# ── Get campaign candidates ───────────────────────────────────────────────────

@router.get(
    "/campaigns/{campaign_id}/candidates",
    response_model=list[OutboundCandidateResponse],
)
def get_campaign_candidates(
    campaign_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    campaign = db.query(OutboundCampaign).filter(OutboundCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your campaign")

    candidates = (
        db.query(OutboundCandidate)
        .filter(OutboundCandidate.campaign_id == campaign_id)
        .order_by(OutboundCandidate.profile_score.desc())
        .all()
    )
    return candidates


# ── Send all outreach emails ──────────────────────────────────────────────────

@router.post("/campaigns/{campaign_id}/send-all", response_model=SendAllResponse)
def send_all_outreach(
    campaign_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_hr),
):
    campaign = db.query(OutboundCampaign).filter(OutboundCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not your campaign")

    now = datetime.now(timezone.utc)
    candidates = (
        db.query(OutboundCandidate)
        .filter(
            OutboundCandidate.campaign_id == campaign_id,
            OutboundCandidate.outreach_status == "draft",
        )
        .all()
    )

    for candidate in candidates:
        candidate.outreach_status = "sent"
        candidate.sent_at = now

    sent_count = len(candidates)
    db.flush()  # write status updates so the count query sees them

    total_sent = (
        db.query(OutboundCandidate)
        .filter(
            OutboundCandidate.campaign_id == campaign_id,
            OutboundCandidate.outreach_status == "sent",
        )
        .count()
    )
    campaign.total_contacted = total_sent

    db.commit()
    return SendAllResponse(sent=sent_count)
