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
    if job.status != "closed":
        raise HTTPException(
            status_code=400,
            detail="Outbound campaigns can only be created for closed jobs",
        )

    campaign = OutboundCampaign(
        job_id=job_id,
        created_by=current_user.id,
        status="running",
        created_at=datetime.now(timezone.utc),
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)

    # Launch background task with its own DB session — cannot share request's session
    asyncio.create_task(run_outbound_campaign(campaign.id))

    return CampaignCreateResponse(campaign_id=campaign.id, status="running")


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
