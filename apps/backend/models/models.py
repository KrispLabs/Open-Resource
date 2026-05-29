import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Text, Float, Integer, Boolean,
    DateTime, ForeignKey, JSON, UniqueConstraint
)
from sqlalchemy.orm import relationship
from database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=_uuid)
    email = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)  # hr | applicant | dev
    created_at = Column(DateTime(timezone=True), default=_now)

    jobs = relationship("Job", back_populates="creator", foreign_keys="Job.created_by")
    applications = relationship("Application", back_populates="applicant")


class Job(Base):
    __tablename__ = "jobs"

    id = Column(String, primary_key=True, default=_uuid)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    location = Column(String)
    job_type = Column(String, default="remote")  # remote | hybrid | onsite
    status = Column(String, default="draft")  # draft | active | closed | sourcing | interviewing | hired | archived
    application_deadline = Column(DateTime(timezone=True))
    shortlist_cutoff = Column(Integer, nullable=True)
    scoring_weights = Column(JSON, default=lambda: {
        "technical_skills": 40, "experience": 25,
        "projects": 20, "education": 8, "communication": 7
    })
    jd_parsed = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    hired_at = Column(DateTime(timezone=True), nullable=True)
    hiring_summary = Column(JSON, nullable=True)  # {selected_count: int, notes: str}

    creator = relationship("User", back_populates="jobs", foreign_keys=[created_by])
    applications = relationship("Application", back_populates="job")
    campaigns = relationship("OutboundCampaign", back_populates="job")
    logs = relationship("SystemLog", back_populates="job")


class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (
        UniqueConstraint("job_id", "applicant_id", name="uq_job_applicant"),
    )

    id = Column(String, primary_key=True, default=_uuid)
    job_id = Column(String, ForeignKey("jobs.id"), nullable=False, index=True)
    applicant_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    resume_filename = Column(String, nullable=False)
    resume_text = Column(Text, nullable=True)
    cover_note = Column(Text, default="")
    status = Column(String, default="pending")  # pending | shortlisted | reviewing | rejected
    rank = Column(Integer, nullable=True)
    submitted_at = Column(DateTime(timezone=True), default=_now)

    job = relationship("Job", back_populates="applications")
    applicant = relationship("User", back_populates="applications")
    candidate_score = relationship("CandidateScore", back_populates="application", uselist=False)
    logs = relationship("SystemLog", back_populates="application")


class CandidateScore(Base):
    __tablename__ = "candidate_scores"

    id = Column(String, primary_key=True, default=_uuid)
    application_id = Column(String, ForeignKey("applications.id"), unique=True, nullable=False)
    technical_score = Column(Float, default=0.0)
    experience_score = Column(Float, default=0.0)
    project_score = Column(Float, default=0.0)
    education_score = Column(Float, default=0.0)
    communication_score = Column(Float, default=0.0)
    weighted_total = Column(Float, default=0.0)
    verdict = Column(String, default="reviewing")  # shortlisted | reviewing | rejected
    reasoning = Column(Text, default="")
    strengths = Column(JSON, default=list)
    gaps = Column(JSON, default=list)
    matched_skills = Column(JSON, default=list)
    missing_skills = Column(JSON, default=list)
    interview_questions = Column(JSON, default=list)
    applicant_feedback = Column(Text, default="")
    scored_at = Column(DateTime(timezone=True), default=_now)

    application = relationship("Application", back_populates="candidate_score")


class OutboundCampaign(Base):
    __tablename__ = "outbound_campaigns"

    id = Column(String, primary_key=True, default=_uuid)
    job_id = Column(String, ForeignKey("jobs.id"), nullable=False)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    status = Column(String, default="running")  # running | complete | paused | error
    github_search_signals = Column(JSON, default=list)
    total_found = Column(Integer, default=0)
    total_contacted = Column(Integer, default=0)
    run_number = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), default=_now)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    job = relationship("Job", back_populates="campaigns")
    candidates = relationship("OutboundCandidate", back_populates="campaign")


class OutboundCandidate(Base):
    __tablename__ = "outbound_candidates"

    id = Column(String, primary_key=True, default=_uuid)
    campaign_id = Column(String, ForeignKey("outbound_campaigns.id"), nullable=False, index=True)
    github_username = Column(String, nullable=False)
    github_url = Column(String, nullable=False)
    name = Column(String, nullable=True)
    bio = Column(Text, nullable=True)
    location = Column(String, nullable=True)
    top_languages = Column(JSON, default=list)
    notable_repos = Column(JSON, default=list)
    followers = Column(Integer, default=0)
    public_repos = Column(Integer, default=0)
    profile_score = Column(Float, default=0.0)
    matched_signals = Column(JSON, default=list)
    gap_signals = Column(JSON, default=list)
    outreach_email = Column(Text, default="")
    outreach_status = Column(String, default="draft")  # draft | sent | opened | replied
    sent_at = Column(DateTime(timezone=True), nullable=True)

    campaign = relationship("OutboundCampaign", back_populates="candidates")


class ScoringConfig(Base):
    __tablename__ = "scoring_config"

    id = Column(String, primary_key=True, default=_uuid)
    label = Column(String, nullable=False)
    weights = Column(JSON, nullable=False)
    is_default = Column(Boolean, default=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now)


class SystemLog(Base):
    __tablename__ = "system_logs"

    id = Column(String, primary_key=True, default=_uuid)
    event_type = Column(String, nullable=False)
    job_id = Column(String, ForeignKey("jobs.id"), nullable=True)
    application_id = Column(String, ForeignKey("applications.id"), nullable=True)
    campaign_id = Column(String, ForeignKey("outbound_campaigns.id"), nullable=True)
    triggered_by = Column(String, ForeignKey("users.id"), nullable=True)
    api_provider = Column(String, nullable=False)  # claude | github
    tokens_used = Column(Integer, nullable=True)
    latency_ms = Column(Integer, nullable=False, default=0)
    status = Column(String, nullable=False)  # success | error
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, index=True)

    job = relationship("Job", back_populates="logs")
    application = relationship("Application", back_populates="logs")
