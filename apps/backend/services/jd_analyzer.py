import time
import json
import re
import httpx
from sqlalchemy.orm import Session
from config import settings
from log_helper import write_log


SYSTEM_PROMPT = """You are an expert technical recruiter and hiring manager.
Analyze the provided job description and extract structured information.
Respond ONLY with valid JSON matching the exact schema provided. No markdown, no explanation."""

JD_ANALYSIS_PROMPT = """Analyze this job description and return a JSON object with exactly these fields:

{
  "role_title": "extracted or inferred job title",
  "seniority": "junior | mid | senior | lead | principal",
  "must_have_skills": ["skill1", "skill2", ...],
  "nice_to_have_skills": ["skill1", "skill2", ...],
  "experience_years_min": 0,
  "proposed_weights": {
    "technical_skills": <number 0-100>,
    "experience": <number 0-100>,
    "projects": <number 0-100>,
    "education": <number 0-100>,
    "communication": <number 0-100>
  },
  "weight_reasoning": "One sentence explaining why you weighted these categories this way for this specific role."
}

Rules:
- proposed_weights values must sum to exactly 100
- must_have_skills: only skills explicitly required in the JD
- nice_to_have_skills: skills listed as preferred/bonus
- experience_years_min: minimum years of experience required (0 if not specified)
- seniority: infer from title and requirements

Job Description:
"""


async def analyze_jd(
    db: Session,
    job_id: str,
    description: str,
    triggered_by: str,
) -> dict:
    start = time.monotonic()
    try:
        messages = [{"role": "user", "content": JD_ANALYSIS_PROMPT + description}]
        headers = {
            "Authorization": f"Bearer {settings.featherlessai_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": "meta-llama/Meta-Llama-3.1-8B-Instruct",
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
            "max_tokens": 1024,
            "temperature": 0.2,
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
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

        # Normalize weights to sum to exactly 100
        weights = parsed.get("proposed_weights", {})
        total = sum(weights.values())
        if total > 0 and abs(total - 100.0) > 0.01:
            factor = 100.0 / total
            parsed["proposed_weights"] = {k: round(v * factor, 2) for k, v in weights.items()}

        latency_ms = int((time.monotonic() - start) * 1000)
        write_log(
            db,
            event_type="jd_analysis",
            api_provider="claude",
            latency_ms=latency_ms,
            status="success",
            job_id=job_id,
            triggered_by=triggered_by,
            tokens_used=tokens_used,
        )
        return parsed

    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        write_log(
            db,
            event_type="jd_analysis",
            api_provider="claude",
            latency_ms=latency_ms,
            status="error",
            job_id=job_id,
            triggered_by=triggered_by,
            error_message=str(exc),
        )
        raise
