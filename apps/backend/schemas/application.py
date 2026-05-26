from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class CandidateScoreResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    technical_score: float
    experience_score: float
    project_score: float
    education_score: float
    communication_score: float
    weighted_total: float
    verdict: str
    reasoning: str
    strengths: list[str]
    gaps: list[str]
    matched_skills: list[str]
    missing_skills: list[str]
    interview_questions: list[str]
    applicant_feedback: str
    scored_at: datetime


class ApplicantScoreView(BaseModel):
    """Score fields safe to show to the applicant — no reasoning or interview_questions."""
    model_config = {"from_attributes": True}

    weighted_total: float
    verdict: str
    technical_score: float
    experience_score: float
    project_score: float
    education_score: float
    communication_score: float
    applicant_feedback: str


class ApplicationResponse(BaseModel):
    """Full application — returned to HR only."""
    model_config = {"from_attributes": True}

    id: str
    job_id: str
    applicant_id: str
    applicant_name: str
    applicant_email: str
    resume_filename: str
    cover_note: str
    status: str
    rank: Optional[int]
    submitted_at: datetime
    candidate_scores: Optional[CandidateScoreResponse] = None


class ApplicantApplicationResponse(BaseModel):
    """Application view for the applicant — score shown only after job closes, reasoning hidden."""
    model_config = {"from_attributes": True}

    id: str
    job_id: str
    job_title: str
    resume_filename: str
    cover_note: str
    status: str
    rank: Optional[int]
    submitted_at: datetime
    scores: Optional[ApplicantScoreView] = None  # None until job is closed


class ApplyRequest(BaseModel):
    cover_note: str = ""

    # validated in endpoint, not here (file comes via multipart)
