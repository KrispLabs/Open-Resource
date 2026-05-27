from pydantic import BaseModel
from datetime import datetime
from typing import Any


class CampaignCreateResponse(BaseModel):
    campaign_id: str
    status: str


class CampaignResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    job_id: str
    status: str
    github_search_signals: Any = None
    total_found: int
    total_contacted: int
    created_at: datetime


class OutboundCandidateResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    github_username: str
    github_url: str
    name: str | None
    bio: str | None
    location: str | None
    top_languages: list[Any]
    notable_repos: list[Any]
    followers: int
    public_repos: int
    profile_score: float
    matched_signals: list[Any]
    gap_signals: list[Any]
    outreach_email: str
    outreach_status: str
    sent_at: datetime | None


class SendAllResponse(BaseModel):
    sent: int
