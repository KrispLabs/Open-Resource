import time
import json
import re
import logging
import httpx
from sqlalchemy.orm import Session
from config import settings
from log_helper import write_log
from services.provider_manager import provider_manager

_log = logging.getLogger(__name__)

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

_REQUIRED_WEIGHT_KEYS = {"technical_skills", "experience", "projects", "education", "communication"}


def _extract_json(raw: str) -> dict:
    """
    Extract a JSON object from LLM output, handling common wrapper formats:
    - Markdown code fences (```json ... ```)
    - Leading/trailing whitespace or prose
    - First { ... last } extraction as final fallback
    """
    # Strip markdown fences
    content = re.sub(r"^```(?:json)?\s*\n?", "", raw, flags=re.MULTILINE)
    content = re.sub(r"\n?```\s*$", "", content, flags=re.MULTILINE)
    content = content.strip()

    # Try direct parse (happy path)
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    # Fallback: first { to last }
    start = content.find("{")
    end = content.rfind("}")
    if start != -1 and end != -1 and start < end:
        try:
            return json.loads(content[start : end + 1])
        except json.JSONDecodeError:
            pass

    raise json.JSONDecodeError(
        f"Could not extract valid JSON. Response preview: {raw[:300]!r}", raw, 0
    )


async def analyze_jd(
    db: Session,
    job_id: str,
    description: str,
    triggered_by: str,
) -> dict:
    start = time.monotonic()
    raw_content: str = ""

    _log.info(
        "[jd_analyze] START job_id=%s triggered_by=%s desc_chars=%d",
        job_id, triggered_by, len(description),
    )

    try:
        featherless_cfg = provider_manager.get("featherless")
        api_key = featherless_cfg.get("api_key") or settings.featherlessai_api_key
        model = featherless_cfg.get("model") or "meta-llama/Meta-Llama-3.1-8B-Instruct"

        _log.info(
            "[jd_analyze] provider=featherless api_key_present=%s model=%s",
            bool(api_key), model,
        )

        if not api_key:
            _log.error(
                "[jd_analyze] ABORT job_id=%s — FEATHERLESSAI_API_KEY is not configured. "
                "Set it in .env or configure via /api/providers/configure.",
                job_id,
            )
            raise ValueError(
                "Featherless API key not configured. Set FEATHERLESSAI_API_KEY in .env "
                "or configure via the Dev portal at /api/providers/configure."
            )

        full_prompt = JD_ANALYSIS_PROMPT + description
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": full_prompt},
            ],
            "max_tokens": 1024,
            "temperature": 0.2,
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        _log.info(
            "[jd_analyze] REQUEST payload_bytes=%d prompt_preview=%r",
            len(json.dumps(payload)), full_prompt[:200],
        )

        req_start = time.monotonic()
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                "https://api.featherless.ai/v1/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()

        resp_latency_ms = int((time.monotonic() - req_start) * 1000)
        data = resp.json()
        raw_content = data["choices"][0]["message"]["content"].strip()
        tokens_used = data.get("usage", {}).get("total_tokens")

        _log.info(
            "[jd_analyze] RESPONSE http_status=%d latency_ms=%d tokens=%s content_preview=%r",
            resp.status_code, resp_latency_ms, tokens_used, raw_content[:300],
        )

        parsed = _extract_json(raw_content)

        _log.info(
            "[jd_analyze] PARSED keys=%s role_title=%r seniority=%r must_have_count=%d",
            list(parsed.keys()),
            parsed.get("role_title"),
            parsed.get("seniority"),
            len(parsed.get("must_have_skills", [])),
        )

        # Validate proposed_weights structure
        weights = parsed.get("proposed_weights", {})
        missing_weight_keys = _REQUIRED_WEIGHT_KEYS - set(weights.keys())
        if missing_weight_keys:
            _log.warning(
                "[jd_analyze] proposed_weights missing categories=%s — filling with 0",
                missing_weight_keys,
            )
            for k in missing_weight_keys:
                weights[k] = 0
            parsed["proposed_weights"] = weights

        # Normalize weights to sum to exactly 100
        total = sum(weights.values())
        _log.info("[jd_analyze] weights_raw=%s weights_sum=%.2f", weights, total)
        if total > 0 and abs(total - 100.0) > 0.01:
            factor = 100.0 / total
            parsed["proposed_weights"] = {k: round(v * factor, 2) for k, v in weights.items()}
            _log.info("[jd_analyze] weights normalized from %.2f → 100.0", total)
        elif total == 0:
            _log.error("[jd_analyze] ALL weights are 0 — using equal distribution fallback")
            equal = round(100.0 / len(_REQUIRED_WEIGHT_KEYS), 2)
            parsed["proposed_weights"] = {k: equal for k in _REQUIRED_WEIGHT_KEYS}

        latency_ms = int((time.monotonic() - start) * 1000)
        _log.info("[jd_analyze] SUCCESS job_id=%s total_ms=%d", job_id, latency_ms)

        write_log(
            db,
            event_type="jd_analysis",
            api_provider="featherless",
            latency_ms=latency_ms,
            status="success",
            job_id=job_id,
            triggered_by=triggered_by,
            tokens_used=tokens_used,
        )
        return parsed

    except httpx.TimeoutException as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        _log.error(
            "[jd_analyze] TIMEOUT job_id=%s elapsed_ms=%d exc=%s",
            job_id, latency_ms, exc,
        )
        write_log(
            db, event_type="jd_analysis", api_provider="featherless",
            latency_ms=latency_ms, status="error", job_id=job_id,
            triggered_by=triggered_by,
            error_message=f"TimeoutException: {exc}",
        )
        raise

    except httpx.HTTPStatusError as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        _log.error(
            "[jd_analyze] HTTP_ERROR job_id=%s status=%d body=%r",
            job_id, exc.response.status_code, exc.response.text[:500],
        )
        write_log(
            db, event_type="jd_analysis", api_provider="featherless",
            latency_ms=latency_ms, status="error", job_id=job_id,
            triggered_by=triggered_by,
            error_message=f"HTTPStatusError {exc.response.status_code}: {exc.response.text[:300]}",
        )
        raise

    except json.JSONDecodeError as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        _log.error(
            "[jd_analyze] JSON_PARSE_ERROR job_id=%s exc=%s raw_content=%r",
            job_id, exc, raw_content[:500],
        )
        write_log(
            db, event_type="jd_analysis", api_provider="featherless",
            latency_ms=latency_ms, status="error", job_id=job_id,
            triggered_by=triggered_by,
            error_message=f"JSONDecodeError: {exc} | raw_preview={raw_content[:200]}",
        )
        raise

    except Exception as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        _log.error(
            "[jd_analyze] UNEXPECTED_ERROR job_id=%s exc_type=%s exc=%s",
            job_id, type(exc).__name__, exc, exc_info=True,
        )
        write_log(
            db, event_type="jd_analysis", api_provider="featherless",
            latency_ms=latency_ms, status="error", job_id=job_id,
            triggered_by=triggered_by,
            error_message=f"{type(exc).__name__}: {exc}",
        )
        raise
