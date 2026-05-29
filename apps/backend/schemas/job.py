from pydantic import BaseModel, field_validator
from datetime import datetime
from typing import Optional, Any


class ScoringWeightsSchema(BaseModel):
    technical_skills: float
    experience: float
    projects: float
    education: float
    communication: float

    @field_validator("technical_skills", "experience", "projects", "education", "communication")
    @classmethod
    def non_negative(cls, v: float) -> float:
        if v < 0:
            raise ValueError("Weight cannot be negative")
        return v


class JDParsedSchema(BaseModel):
    role_title: str
    seniority: str
    must_have_skills: list[str]
    nice_to_have_skills: list[str]
    experience_years_min: int
    proposed_weights: ScoringWeightsSchema
    weight_reasoning: str


class JobCreateRequest(BaseModel):
    title: str
    description: str
    location: str = ""
    job_type: str = "remote"
    application_deadline: Optional[datetime] = None

    @field_validator("description")
    @classmethod
    def description_min_length(cls, v: str) -> str:
        if len(v.split()) < 50:
            raise ValueError("Job description must be at least 50 words for accurate AI analysis")
        return v


class ArchiveJobRequest(BaseModel):
    pass


class HireJobRequest(BaseModel):
    selected_count: int
    notes: str = ""


class ReopenJobRequest(BaseModel):
    reset_scoring: bool = False


class MoveToInterviewingRequest(BaseModel):
    pass


class JobUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    job_type: Optional[str] = None
    application_deadline: Optional[datetime] = None
    shortlist_cutoff: Optional[int] = None


class WeightsUpdateRequest(BaseModel):
    scoring_weights: ScoringWeightsSchema

    @field_validator("scoring_weights")
    @classmethod
    def weights_sum_to_100(cls, v: ScoringWeightsSchema) -> ScoringWeightsSchema:
        total = (
            v.technical_skills + v.experience + v.projects
            + v.education + v.communication
        )
        if abs(total - 100.0) > 0.01:
            raise ValueError(f"Weights must sum to 100. Currently: {total:.1f}")
        return v


class JobResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    created_by: str
    title: str
    description: str
    location: str | None
    job_type: str
    status: str
    application_deadline: datetime | None
    shortlist_cutoff: int | None
    scoring_weights: dict
    jd_parsed: dict | None
    created_at: datetime
    closed_at: datetime | None
    hired_at: datetime | None = None
    hiring_summary: Any = None
    application_count: int = 0


class JobListResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    title: str
    location: str | None
    job_type: str
    status: str
    application_deadline: datetime | None
    created_at: datetime
    hired_at: datetime | None = None
    application_count: int = 0
