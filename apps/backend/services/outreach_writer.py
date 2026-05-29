"""
Scores a GitHub developer profile against a job description and generates
a personalized outreach email using Featherless AI.
Same httpx pattern as jd_analyzer.py.
"""
import json
import re
import httpx

FEATHERLESS_API_BASE = "https://api.featherless.ai/v1/chat/completions"
FEATHERLESS_MODEL = "meta-llama/Meta-Llama-3.1-8B-Instruct"

OUTREACH_SYSTEM_PROMPT = (
    "You are an expert technical recruiter. Score a GitHub developer profile against a job "
    "description and write a personalized outreach email. Return ONLY valid JSON with no markdown."
)

OUTREACH_USER_TEMPLATE = """Score this GitHub developer against the job and write a personalized outreach email.

JOB: {role_title} — must-have: {must_have_skills}
DEVELOPER PROFILE:
- Username: {login}
- Name: {name}
- Bio: {bio}
- Location: {location}
- Top languages: {top_languages}
- Notable repos: {notable_repos}
- Followers: {followers}, Public repos: {public_repos}

Return JSON with:
- profile_score: integer 0-100
- matched_signals: array of strings describing specific matches (reference actual repo names and skills)
- gap_signals: array of strings describing gaps
- outreach_email: personalized email string — MUST reference at least one specific repo name from their profile. Must feel personal, not generic. Format: "Hi {name_placeholder},\\n\\n[specific observation about their work]\\n\\n[job pitch]\\n\\nWould you be open to a quick conversation?\\n\\nBest,\\n{hr_name_placeholder}"
"""


async def score_and_write_outreach(
    profile: dict,
    jd_parsed: dict,
    weights: dict,
    featherless_api_key: str,
    hr_name: str,
) -> dict:
    """
    Call Featherless AI to score a GitHub profile and generate a personalized outreach email.
    Returns a dict with: profile_score, matched_signals, gap_signals, outreach_email.
    Retries once on malformed JSON.
    """
    developer_name = profile.get("name") or profile.get("login", "Developer")
    role_title = jd_parsed.get("role_title", "Software Engineer")
    must_have_skills = jd_parsed.get("must_have_skills", [])

    user_content = OUTREACH_USER_TEMPLATE.format(
        role_title=role_title,
        must_have_skills=must_have_skills,
        login=profile.get("login", ""),
        name=developer_name,
        bio=profile.get("bio") or "N/A",
        location=profile.get("location") or "N/A",
        top_languages=profile.get("top_languages", []),
        notable_repos=profile.get("notable_repos", []),
        followers=profile.get("followers", 0),
        public_repos=profile.get("public_repos", 0),
        name_placeholder=developer_name,
        hr_name_placeholder=hr_name,
    )

    headers = {
        "Authorization": f"Bearer {featherless_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": FEATHERLESS_MODEL,
        "messages": [
            {"role": "system", "content": OUTREACH_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "max_tokens": 1024,
        "temperature": 0.3,
    }

    async def _call_api() -> str:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(FEATHERLESS_API_BASE, headers=headers, json=payload)
            resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()

    def _parse_content(content: str) -> dict:
        cleaned = re.sub(r"^```(?:json)?\s*", "", content)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        return json.loads(cleaned)

    # First attempt
    content = await _call_api()
    try:
        return _parse_content(content)
    except (json.JSONDecodeError, ValueError):
        pass

    # Retry once on malformed JSON
    content = await _call_api()
    return _parse_content(content)
