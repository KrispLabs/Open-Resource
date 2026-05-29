import asyncio
import time
import json
import re
import httpx
from pathlib import Path
from sqlalchemy.orm import Session

from config import settings
from log_helper import write_log
from services.pdf_parser import extract_text_from_pdf
from services.provider_manager import provider_manager
from models.models import Application, CandidateScore

SCORE_SYSTEM_PROMPT = """You are an expert technical recruiter performing structured candidate evaluation.
Analyze the provided resume against the job requirements and scoring weights.
Respond ONLY with valid JSON matching the exact schema. No markdown, no explanation."""

SCORE_PROMPT_TEMPLATE = """Score this candidate's resume against the job description.

JOB TITLE: {job_title}
JOB DESCRIPTION:
{job_description}

SCORING WEIGHTS (these determine how much each category contributes to the final score):
- technical_skills: {w_technical}%
- experience: {w_experience}%
- projects: {w_projects}%
- education: {w_education}%
- communication: {w_communication}%

CANDIDATE RESUME:
{resume_text}

Return a JSON object with EXACTLY these fields:
{{
  "technical_score": <0-100 float>,
  "experience_score": <0-100 float>,
  "project_score": <0-100 float>,
  "education_score": <0-100 float>,
  "communication_score": <0-100 float>,
  "verdict": "shortlisted" | "reviewing" | "rejected",
  "reasoning": "3-4 sentence narrative explaining this candidate's overall fit",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "gaps": ["gap 1", "gap 2"],
  "matched_skills": ["skill1", "skill2"],
  "missing_skills": ["skill1", "skill2"],
  "interview_questions": ["question 1", "question 2", "question 3"],
  "applicant_feedback": "2-3 sentence encouraging but honest feedback written directly to the applicant"
}}

Rules:
- Scores are 0-100. Be calibrated: 90+ = exceptional, 70-89 = strong, 50-69 = average, <50 = weak
- verdict: shortlisted if weighted_total >= 70, rejected if <= 45, reviewing otherwise
- strengths: exactly 3 specific, evidence-backed points from the resume
- gaps: 1-3 concrete missing requirements
- matched_skills: skills from the JD that appear in the resume
- missing_skills: required skills from JD not found in resume
- interview_questions: 3 role-specific technical or behavioural questions
- applicant_feedback: written TO the applicant, professional, no mention of specific scores
"""


def _compute_weighted_total(scores: dict, weights: dict) -> float:
    total = (
        scores["technical_score"] * weights.get("technical_skills", 40) / 100
        + scores["experience_score"] * weights.get("experience", 25) / 100
        + scores["project_score"] * weights.get("projects", 20) / 100
        + scores["education_score"] * weights.get("education", 8) / 100
        + scores["communication_score"] * weights.get("communication", 7) / 100
    )
    return round(total, 2)


async def score_candidate(
    application: Application,
    job_description: str,
    job_title: str,
    scoring_weights: dict,
    upload_dir: str,
    db: Session,
) -> CandidateScore:
    start = time.monotonic()
    resume_path = Path(upload_dir) / application.job_id / application.resume_filename

    try:
        resume_text = extract_text_from_pdf(resume_path)
    except (FileNotFoundError, ValueError) as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        write_log(
            db,
            event_type="candidate_scoring",
            api_provider="featherless",
            latency_ms=latency_ms,
            status="error",
            job_id=application.job_id,
            application_id=application.id,
            triggered_by=None,
            error_message=str(exc),
        )
        raise

    prompt = SCORE_PROMPT_TEMPLATE.format(
        job_title=job_title,
        job_description=job_description[:3000],  # cap to avoid token overflow
        resume_text=resume_text[:4000],
        w_technical=scoring_weights.get("technical_skills", 40),
        w_experience=scoring_weights.get("experience", 25),
        w_projects=scoring_weights.get("projects", 20),
        w_education=scoring_weights.get("education", 8),
        w_communication=scoring_weights.get("communication", 7),
    )

    featherless_cfg = provider_manager.get("featherless")
    api_key = featherless_cfg.get("api_key") or settings.featherlessai_api_key
    model = featherless_cfg.get("model") or "meta-llama/Meta-Llama-3.1-8B-Instruct"

    if not api_key:
        raise ValueError(
            "Featherless API key not configured. Set FEATHERLESSAI_API_KEY in .env "
            "or configure via /api/providers/configure."
        )

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SCORE_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 1500,
        "temperature": 0.1,
    }

    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(
            "https://api.featherless.ai/v1/chat/completions",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()

    data = resp.json()
    content = data["choices"][0]["message"]["content"].strip()
    tokens_used = data.get("usage", {}).get("total_tokens")

    # Strip markdown code fences if present
    content = re.sub(r"^```(?:json)?\s*", "", content)
    content = re.sub(r"\s*```$", "", content)
    parsed = json.loads(content)

    weighted_total = _compute_weighted_total(parsed, scoring_weights)

    # Enforce verdict based on weighted total
    if weighted_total >= 70:
        verdict = "shortlisted"
    elif weighted_total <= 45:
        verdict = "rejected"
    else:
        verdict = "reviewing"

    latency_ms = int((time.monotonic() - start) * 1000)

    write_log(
        db,
        event_type="candidate_scoring",
        api_provider="featherless",
        latency_ms=latency_ms,
        status="success",
        job_id=application.job_id,
        application_id=application.id,
        tokens_used=tokens_used,
    )

    score = CandidateScore(
        application_id=application.id,
        technical_score=parsed.get("technical_score", 0),
        experience_score=parsed.get("experience_score", 0),
        project_score=parsed.get("project_score", 0),
        education_score=parsed.get("education_score", 0),
        communication_score=parsed.get("communication_score", 0),
        weighted_total=weighted_total,
        verdict=verdict,
        reasoning=parsed.get("reasoning", ""),
        strengths=parsed.get("strengths", []),
        gaps=parsed.get("gaps", []),
        matched_skills=parsed.get("matched_skills", []),
        missing_skills=parsed.get("missing_skills", []),
        interview_questions=parsed.get("interview_questions", []),
        applicant_feedback=parsed.get("applicant_feedback", ""),
    )
    db.add(score)
    db.commit()
    db.refresh(score)
    return score
