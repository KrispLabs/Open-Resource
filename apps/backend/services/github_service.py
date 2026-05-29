"""
GitHub developer search and profile fetching using the GitHub REST API.
Uses httpx for async HTTP calls — same pattern as jd_analyzer.py.
"""
import asyncio
import json
import logging
import re
import time
from datetime import datetime, timezone
import httpx
from config import settings
from log_helper import write_log

_log = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"
FEATHERLESS_API_BASE = "https://api.featherless.ai/v1/chat/completions"
FEATHERLESS_MODEL = "meta-llama/Meta-Llama-3.1-8B-Instruct"

SIGNALS_SYSTEM_PROMPT = (
    "You are an expert technical recruiter. Extract GitHub search signals from a job description "
    "analysis. Return ONLY valid JSON with no markdown."
)

SIGNALS_USER_TEMPLATE = (
    "Given this parsed job description, extract GitHub search signals. "
    "Return JSON with: languages (array of programming languages), "
    "keywords (array of technical keywords for GitHub search), "
    "location_hint (string or empty), "
    "search_queries (array of 2-3 GitHub search query strings like "
    "'language:python fastapi stars:>50'). "
    "jd_parsed: {jd_parsed}"
)


def _github_headers(github_token: str) -> dict:
    return {
        "Authorization": f"token {github_token}",
        "Accept": "application/vnd.github.v3+json",
    }


async def extract_github_signals(jd_parsed: dict, featherless_api_key: str) -> dict:
    """
    Call Featherless AI to extract GitHub search signals from a parsed JD.
    Returns a dict with: languages, keywords, location_hint, search_queries.
    """
    user_content = SIGNALS_USER_TEMPLATE.format(jd_parsed=json.dumps(jd_parsed))
    headers = {
        "Authorization": f"Bearer {featherless_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": FEATHERLESS_MODEL,
        "messages": [
            {"role": "system", "content": SIGNALS_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "max_tokens": 512,
        "temperature": 0.2,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(FEATHERLESS_API_BASE, headers=headers, json=payload)
        resp.raise_for_status()

    data = resp.json()
    content = data["choices"][0]["message"]["content"].strip()

    _log.info("[outbound_signals] raw_response_len=%d", len(content))

    # Strip markdown code fences (multiline-safe, same as jd_analyzer._extract_json)
    content = re.sub(r"^```(?:json)?\s*\n?", "", content, flags=re.MULTILINE)
    content = re.sub(r"\n?```\s*$", "", content, flags=re.MULTILINE)
    content = content.strip()

    # Try direct parse (happy path — clean JSON response)
    try:
        result = json.loads(content)
        _log.info("[outbound_signals] direct_parse=success keys=%s", list(result.keys()))
        return result
    except json.JSONDecodeError:
        _log.warning("[outbound_signals] direct_parse=failed trying brace-extraction fallback")

    # Fallback: first { to last } — handles trailing prose after the JSON block
    start = content.find("{")
    end = content.rfind("}")
    if start != -1 and end != -1 and start < end:
        try:
            result = json.loads(content[start : end + 1])
            _log.info(
                "[outbound_signals] fallback_parse=success keys=%s",
                list(result.keys()),
            )
            return result
        except json.JSONDecodeError:
            _log.error(
                "[outbound_signals] fallback_parse=failed content_preview=%r",
                content[:300],
            )

    raise json.JSONDecodeError(
        f"Could not extract valid JSON from signals response. Preview: {content[:300]!r}",
        content,
        0,
    )


async def search_github_users(query: str, github_token: str) -> list[dict]:
    """
    Search GitHub for users matching `query`.
    Returns a list of {login, avatar_url, html_url} dicts.
    Raises ValueError on rate limit, returns [] on invalid query.
    """
    url = f"{GITHUB_API_BASE}/search/users"
    params = {"q": query, "per_page": 10, "sort": "followers"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, headers=_github_headers(github_token), params=params)

    if resp.status_code == 403:
        raise ValueError("GitHub API rate limit reached. Try again in 60 seconds.")
    if resp.status_code == 422:
        return []

    resp.raise_for_status()
    data = resp.json()

    return [
        {
            "login": item["login"],
            "avatar_url": item.get("avatar_url", ""),
            "html_url": item.get("html_url", f"https://github.com/{item['login']}"),
        }
        for item in data.get("items", [])
    ]


async def fetch_github_profile(username: str, github_token: str) -> dict | None:
    """
    Fetch full GitHub profile and top repos for `username`.
    Returns None if the account has been deleted (404).
    """
    user_url = f"{GITHUB_API_BASE}/users/{username}"
    repos_url = f"{GITHUB_API_BASE}/users/{username}/repos"
    gh_headers = _github_headers(github_token)

    async with httpx.AsyncClient(timeout=30.0) as client:
        user_resp, repos_resp = await asyncio.gather(
            client.get(user_url, headers=gh_headers),
            client.get(repos_url, headers=gh_headers, params={"sort": "stars", "per_page": 5}),
        )

    if user_resp.status_code == 404 or repos_resp.status_code == 404:
        return None

    user_resp.raise_for_status()
    repos_resp.raise_for_status()

    user_data = user_resp.json()
    repos_data = repos_resp.json()

    # Collect unique languages from repos (exclude None), max 5
    languages_seen: list[str] = []
    for repo in repos_data:
        lang = repo.get("language")
        if lang and lang not in languages_seen:
            languages_seen.append(lang)
        if len(languages_seen) >= 5:
            break

    # Build notable repos list (up to 5)
    notable_repos = [
        {
            "name": repo.get("name", ""),
            "stars": repo.get("stargazers_count", 0),
            "description": repo.get("description", ""),
            "language": repo.get("language", ""),
        }
        for repo in repos_data[:5]
    ]

    return {
        "login": user_data.get("login", username),
        "name": user_data.get("name"),
        "bio": user_data.get("bio"),
        "location": user_data.get("location"),
        "followers": user_data.get("followers", 0),
        "public_repos": user_data.get("public_repos", 0),
        "avatar_url": user_data.get("avatar_url", ""),
        "html_url": user_data.get("html_url", f"https://github.com/{username}"),
        "top_languages": languages_seen,
        "notable_repos": notable_repos,
    }


async def run_outbound_campaign(campaign_id: str) -> None:
    """
    Background task: runs the full outbound sourcing pipeline for a campaign.
    Opens its own DB session — never shares the request session.
    """
    from database import SessionLocal
    from models.models import OutboundCampaign, OutboundCandidate, Job
    from services.outreach_writer import score_and_write_outreach

    db = SessionLocal()
    try:
        campaign = db.query(OutboundCampaign).filter(OutboundCampaign.id == campaign_id).first()
        if not campaign:
            return

        job = db.query(Job).filter(Job.id == campaign.job_id).first()
        if not job:
            campaign.status = "error"
            campaign.completed_at = datetime.now(timezone.utc)
            db.commit()
            return

        jd_parsed = job.jd_parsed or {}
        scoring_weights = job.scoring_weights or {}

        from services.provider_manager import provider_manager
        featherless_cfg = provider_manager.get("featherless")
        featherless_api_key = featherless_cfg.get("api_key") or settings.featherlessai_api_key
        featherless_model = featherless_cfg.get("model", FEATHERLESS_MODEL)

        github_cfg = provider_manager.get("github")
        github_token = github_cfg.get("token") or settings.github_token

        brightdata_cfg = provider_manager.get("brightdata")
        brightdata_api_key = brightdata_cfg.get("api_key") or settings.brightdata_api_key
        brightdata_serp_zone = brightdata_cfg.get("serp_zone") or settings.brightdata_serp_zone or "serp_api2"
        use_brightdata = bool(brightdata_api_key)

        # Pre-flight: Featherless key is required for signals + scoring
        if not featherless_api_key:
            write_log(
                db,
                event_type="outbound_campaign",
                api_provider="featherless",
                latency_ms=0,
                status="error",
                campaign_id=campaign_id,
                error_message="Featherless API key not configured. Set FEATHERLESSAI_API_KEY in .env or configure via /api/providers/configure.",
            )
            campaign.status = "error"
            campaign.completed_at = datetime.now(timezone.utc)
            db.commit()
            return

        if not use_brightdata and not github_token:
            write_log(
                db,
                event_type="outbound_campaign",
                api_provider="github",
                latency_ms=0,
                status="error",
                campaign_id=campaign_id,
                error_message="No GitHub sourcing provider configured. Set GITHUB_TOKEN or BRIGHTDATA_API_KEY in .env.",
            )
            campaign.status = "error"
            campaign.completed_at = datetime.now(timezone.utc)
            db.commit()
            return

        if not jd_parsed:
            write_log(
                db,
                event_type="outbound_campaign",
                api_provider="featherless",
                latency_ms=0,
                status="error",
                campaign_id=campaign_id,
                error_message="Job has no parsed JD. Run POST /jobs/{id}/analyze before launching a campaign.",
            )
            campaign.status = "error"
            campaign.completed_at = datetime.now(timezone.utc)
            db.commit()
            return

        # Step 1: extract signals
        try:
            signals = await extract_github_signals(jd_parsed, featherless_api_key)
        except Exception as exc:
            write_log(
                db,
                event_type="outbound_signals",
                api_provider="featherless",
                latency_ms=0,
                status="error",
                campaign_id=campaign_id,
                error_message=str(exc),
            )
            campaign.status = "error"
            campaign.completed_at = datetime.now(timezone.utc)
            db.commit()
            return

        campaign.github_search_signals = signals
        db.commit()

        search_queries = signals.get("search_queries", [])
        if not search_queries:
            campaign.status = "complete"
            campaign.completed_at = datetime.now(timezone.utc)
            db.commit()
            return

        # Step 2: search users across all queries, deduplicate by login
        # Bright Data SERP path: Google's full index, no GitHub rate limits
        # Fallback path: GitHub REST API (requires github_token)
        all_users: dict[str, dict] = {}

        if use_brightdata:
            from services.bright_data_service import search_candidates_serp
            for query in search_queries:
                try:
                    start = time.monotonic()
                    results = await search_candidates_serp(query, brightdata_api_key, brightdata_serp_zone)
                    latency_ms = int((time.monotonic() - start) * 1000)
                    for user in results:
                        login = user["login"]
                        if login not in all_users:
                            all_users[login] = user
                    write_log(
                        db,
                        event_type="github_search",
                        api_provider="brightdata",
                        latency_ms=latency_ms,
                        status="success",
                        campaign_id=campaign_id,
                    )
                except ValueError as exc:
                    write_log(
                        db,
                        event_type="github_search",
                        api_provider="brightdata",
                        latency_ms=0,
                        status="error",
                        campaign_id=campaign_id,
                        error_message=str(exc),
                    )
                    break
                except Exception as exc:
                    write_log(
                        db,
                        event_type="github_search",
                        api_provider="brightdata",
                        latency_ms=0,
                        status="error",
                        campaign_id=campaign_id,
                        error_message=str(exc),
                    )
        else:
            for query in search_queries:
                try:
                    results = await search_github_users(query, github_token)
                    for user in results:
                        login = user["login"]
                        if login not in all_users:
                            all_users[login] = user
                except ValueError as exc:
                    # Rate limit — log and stop further queries
                    write_log(
                        db,
                        event_type="github_search",
                        api_provider="github",
                        latency_ms=0,
                        status="error",
                        campaign_id=campaign_id,
                        error_message=str(exc),
                    )
                    break
                except Exception as exc:
                    write_log(
                        db,
                        event_type="github_search",
                        api_provider="github",
                        latency_ms=0,
                        status="error",
                        campaign_id=campaign_id,
                        error_message=str(exc),
                    )

        _log.info("[outbound] users_found_total=%d logins=%s", len(all_users), list(all_users.keys()))

        if not all_users:
            campaign.status = "complete"
            campaign.completed_at = datetime.now(timezone.utc)
            db.commit()
            return

        # Step 3: fetch full profiles
        # Bright Data path: one batch call for all usernames (no per-profile rate limits)
        # Fallback path: parallel GitHub REST calls with Semaphore(10)
        if use_brightdata:
            from services.bright_data_service import fetch_profiles_dataset
            start = time.monotonic()
            profiles = await fetch_profiles_dataset(
                list(all_users.keys()),
                brightdata_api_key,
                settings.brightdata_dataset_id,
            )
            latency_ms = int((time.monotonic() - start) * 1000)
            _log.info(
                "[outbound] brightdata_profiles requested=%d returned=%d",
                len(all_users), len(profiles),
            )
            write_log(
                db,
                event_type="github_profile_fetch",
                api_provider="brightdata",
                latency_ms=latency_ms,
                status="success" if profiles else "error",
                campaign_id=campaign_id,
                error_message=None if profiles else "No profiles returned from Bright Data dataset",
            )
        else:
            profile_semaphore = asyncio.Semaphore(10)

            async def _fetch_with_semaphore(login: str) -> dict | None:
                async with profile_semaphore:
                    try:
                        start = time.monotonic()
                        profile = await fetch_github_profile(login, github_token)
                        latency_ms = int((time.monotonic() - start) * 1000)
                        write_log(
                            db,
                            event_type="github_profile_fetch",
                            api_provider="github",
                            latency_ms=latency_ms,
                            status="success" if profile else "error",
                            campaign_id=campaign_id,
                            error_message=None if profile else f"Profile not found: {login}",
                        )
                        return profile
                    except Exception as exc:
                        write_log(
                            db,
                            event_type="github_profile_fetch",
                            api_provider="github",
                            latency_ms=0,
                            status="error",
                            campaign_id=campaign_id,
                            error_message=str(exc),
                        )
                        return None

            profile_results = await asyncio.gather(
                *[_fetch_with_semaphore(login) for login in all_users]
            )
            profiles = [p for p in profile_results if p is not None]

        # Step 4: score each profile and generate outreach (semaphore 3)
        score_semaphore = asyncio.Semaphore(3)

        # Determine HR name for outreach email
        from models.models import User
        hr_user = db.query(User).filter(User.id == campaign.created_by).first()
        hr_name = hr_user.name if hr_user else "Hiring Manager"

        async def _score_profile(profile: dict) -> dict | None:
            async with score_semaphore:
                try:
                    start = time.monotonic()
                    result = await score_and_write_outreach(
                        profile=profile,
                        jd_parsed=jd_parsed,
                        weights=scoring_weights,
                        featherless_api_key=featherless_api_key,
                        hr_name=hr_name,
                    )
                    latency_ms = int((time.monotonic() - start) * 1000)
                    write_log(
                        db,
                        event_type="outbound_profile_score",
                        api_provider="featherless",
                        latency_ms=latency_ms,
                        status="success",
                        campaign_id=campaign_id,
                    )
                    return {**profile, **result}
                except Exception as exc:
                    write_log(
                        db,
                        event_type="outbound_profile_score",
                        api_provider="featherless",
                        latency_ms=0,
                        status="error",
                        campaign_id=campaign_id,
                        error_message=str(exc),
                    )
                    return None

        scored_results = await asyncio.gather(*[_score_profile(p) for p in profiles])

        # Step 5: persist OutboundCandidate rows
        saved_count = 0
        for scored in scored_results:
            if scored is None:
                continue
            candidate = OutboundCandidate(
                campaign_id=campaign_id,
                github_username=scored.get("login", ""),
                github_url=scored.get("html_url", f"https://github.com/{scored.get('login', '')}"),
                name=scored.get("name"),
                bio=scored.get("bio"),
                location=scored.get("location"),
                top_languages=scored.get("top_languages", []),
                notable_repos=scored.get("notable_repos", []),
                followers=scored.get("followers", 0),
                public_repos=scored.get("public_repos", 0),
                profile_score=scored.get("profile_score", 0),
                matched_signals=scored.get("matched_signals", []),
                gap_signals=scored.get("gap_signals", []),
                outreach_email=scored.get("outreach_email", ""),
                outreach_status="draft",
            )
            db.add(candidate)
            saved_count += 1

        campaign.status = "complete"
        campaign.total_found = saved_count
        campaign.completed_at = datetime.now(timezone.utc)
        db.commit()

    except Exception as exc:
        try:
            campaign = db.query(OutboundCampaign).filter(OutboundCampaign.id == campaign_id).first()
            if campaign:
                campaign.status = "error"
                campaign.completed_at = datetime.now(timezone.utc)
                db.commit()
        except Exception:
            pass
        write_log(
            db,
            event_type="outbound_campaign",
            api_provider="github",
            latency_ms=0,
            status="error",
            campaign_id=campaign_id,
            error_message=str(exc),
        )
    finally:
        db.close()
