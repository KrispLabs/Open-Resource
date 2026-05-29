"""
GitHub developer search and profile fetching using the GitHub REST API.
Uses httpx for async HTTP calls — same pattern as jd_analyzer.py.
"""
import asyncio
import json
import logging
import re
import time
from datetime import datetime, timezone, timedelta
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


def _bg_write_log(**kwargs) -> None:
    """
    Write a SystemLog on its OWN short-lived session.

    Used from inside concurrent asyncio tasks (profile fetch / profile scoring),
    where calling write_log() on the campaign's shared session would interleave
    commits from multiple coroutines on a single SQLAlchemy Session — which is
    not safe and corrupts each other's unit of work. Failures here are swallowed:
    a logging hiccup must never abort a sourcing campaign.
    """
    from database import SessionLocal
    s = SessionLocal()
    try:
        write_log(s, **kwargs)
    except Exception:
        s.rollback()
    finally:
        s.close()


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


def _build_profile(username: str, user_data: dict, repos_data: list, recent_days: int) -> dict:
    """
    Map GitHub REST /users + /users/{u}/repos payloads into the existing ProfileSchema dict.
    Output shape is a superset of fetch_github_profile() — same keys plus the additive
    `total_stars` and `recent_activity` fields. The scorer reads only the shared keys.
    """
    languages_seen: list[str] = []
    total_stars = 0
    most_recent_push: datetime | None = None

    for repo in repos_data:
        total_stars += repo.get("stargazers_count", 0) or 0
        lang = repo.get("language")
        if lang and lang not in languages_seen:
            languages_seen.append(lang)
        pushed = repo.get("pushed_at")
        if pushed:
            try:
                pushed_dt = datetime.fromisoformat(pushed.replace("Z", "+00:00"))
                if most_recent_push is None or pushed_dt > most_recent_push:
                    most_recent_push = pushed_dt
            except (ValueError, AttributeError):
                pass

    # notable repos: top 5 by stars (mirror fetch_github_profile's shape exactly)
    sorted_repos = sorted(
        repos_data, key=lambda r: r.get("stargazers_count", 0) or 0, reverse=True
    )
    notable_repos = [
        {
            "name": r.get("name", ""),
            "stars": r.get("stargazers_count", 0) or 0,
            "description": r.get("description", "") or "",
            "language": r.get("language", "") or "",
        }
        for r in sorted_repos[:5]
    ]

    recent_activity = False
    if most_recent_push is not None:
        recent_activity = (datetime.now(timezone.utc) - most_recent_push) <= timedelta(days=recent_days)

    return {
        "login": user_data.get("login", username),
        "name": user_data.get("name"),
        "bio": user_data.get("bio"),
        "location": user_data.get("location"),
        "followers": user_data.get("followers", 0),
        "public_repos": user_data.get("public_repos", 0),
        "avatar_url": user_data.get("avatar_url", ""),
        "html_url": user_data.get("html_url", f"https://github.com/{username}"),
        "top_languages": languages_seen[:5],
        "notable_repos": notable_repos,
        "total_stars": total_stars,
        "recent_activity": recent_activity,
    }


async def fetch_profiles_pat(
    usernames: list[str],
    github_token: str,
    max_concurrency: int = 5,
    max_retries: int = 2,
) -> list[dict]:
    """
    Batch-enrich GitHub usernames into the existing ProfileSchema via the GitHub REST API.

    Drop-in replacement for the broken Bright Data fetch_profiles_dataset(): emits the same
    dict shape as fetch_github_profile() (plus additive total_stars / recent_activity).

    Behavior:
      - async, bounded by Semaphore(max_concurrency)
      - per username: GET /users/{u}  +  GET /users/{u}/repos?sort=pushed&per_page=100 (concurrent)
      - retries (max_retries) on 5xx / timeout / secondary rate limit (403 + Retry-After), backoff
      - 404 (deleted/suspended account) -> logged + skipped; one bad user never fails the batch
      - 401 (invalid PAT) -> raised so the whole campaign fails *visibly* (never a silent zero)

    Returns list[ProfileSchema]; usernames that fail (non-401) are omitted.
    """
    if not usernames:
        return []

    gh_headers = _github_headers(github_token)
    semaphore = asyncio.Semaphore(max_concurrency)
    RECENT_ACTIVITY_DAYS = 180

    async def _fetch_one(username: str) -> dict | None:
        user_url = f"{GITHUB_API_BASE}/users/{username}"
        repos_url = f"{GITHUB_API_BASE}/users/{username}/repos"
        repos_params = {"sort": "pushed", "per_page": 100}

        attempt = 0
        async with semaphore:
            while True:
                try:
                    async with httpx.AsyncClient(timeout=30.0) as client:
                        user_resp, repos_resp = await asyncio.gather(
                            client.get(user_url, headers=gh_headers),
                            client.get(repos_url, headers=gh_headers, params=repos_params),
                        )

                    # Invalid / expired token — fail loud (propagates out of gather)
                    if user_resp.status_code == 401:
                        raise ValueError(
                            "GitHub PAT invalid or expired (401). Set a valid GITHUB_TOKEN."
                        )

                    # Deleted / suspended / nonexistent account — skip this candidate
                    if user_resp.status_code == 404:
                        _log.warning("[outbound_pat] user not found (404): %s", username)
                        return None

                    # Secondary rate limit / abuse detection — retry honoring Retry-After
                    if user_resp.status_code == 403:
                        if attempt < max_retries:
                            retry_after = float(user_resp.headers.get("Retry-After", 2 ** attempt))
                            _log.warning(
                                "[outbound_pat] 403 for %s — retry %d after %.1fs",
                                username, attempt + 1, retry_after,
                            )
                            await asyncio.sleep(min(retry_after, 10.0))
                            attempt += 1
                            continue
                        _log.error("[outbound_pat] 403 exhausted for %s — skipping", username)
                        return None

                    user_resp.raise_for_status()
                    user_data = user_resp.json()

                    # Repos are best-effort: a failed repos call yields empty languages/repos
                    repos_data: list = []
                    if repos_resp.status_code == 200:
                        repos_data = repos_resp.json()
                    else:
                        _log.warning(
                            "[outbound_pat] repos fetch failed for %s: HTTP %d",
                            username, repos_resp.status_code,
                        )

                    return _build_profile(username, user_data, repos_data, RECENT_ACTIVITY_DAYS)

                except ValueError:
                    raise  # 401 — propagate so the campaign errors visibly
                except (httpx.TimeoutException, httpx.HTTPStatusError, httpx.TransportError) as exc:
                    if attempt < max_retries:
                        backoff = 2 ** attempt
                        _log.warning(
                            "[outbound_pat] %s for %s — retry %d after %ds",
                            type(exc).__name__, username, attempt + 1, backoff,
                        )
                        await asyncio.sleep(backoff)
                        attempt += 1
                        continue
                    _log.error(
                        "[outbound_pat] %s exhausted for %s — skipping: %s",
                        type(exc).__name__, username, exc,
                    )
                    return None
                except Exception as exc:
                    _log.error("[outbound_pat] unexpected error for %s — skipping: %s", username, exc)
                    return None

    results = await asyncio.gather(*[_fetch_one(u) for u in usernames])
    profiles = [p for p in results if p is not None]
    _log.info("[outbound_pat] enriched %d/%d profiles", len(profiles), len(usernames))
    return profiles


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

        # Profile enrichment now ALWAYS uses the GitHub PAT (Bright Data Dataset API replaced —
        # see OUTBOUND_PAT_MIGRATION_PLAN.md). A GitHub token is therefore mandatory regardless
        # of the discovery provider. This subsumes the old "no sourcing provider" check, since
        # the GitHub-search discovery fallback also requires the token.
        if not github_token:
            write_log(
                db,
                event_type="outbound_campaign",
                api_provider="github",
                latency_ms=0,
                status="error",
                campaign_id=campaign_id,
                error_message="GitHub PAT required for profile enrichment. Set GITHUB_TOKEN in .env or configure via /api/providers/configure.",
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

        # Step 3: enrich full profiles
        # Discovery may have used Bright Data SERP, but enrichment is ALWAYS GitHub PAT now —
        # the Bright Data Dataset API stage was removed (404 Dataset Not Found on this account).
        # SERP path: batched concurrent PAT enrichment via fetch_profiles_pat().
        # Fallback path: per-profile fetch_github_profile() (UNCHANGED).
        if use_brightdata:
            try:
                start = time.monotonic()
                profiles = await fetch_profiles_pat(list(all_users.keys()), github_token)
                latency_ms = int((time.monotonic() - start) * 1000)
                _log.info(
                    "[outbound] pat_profiles requested=%d returned=%d",
                    len(all_users), len(profiles),
                )
                write_log(
                    db,
                    event_type="github_profile_fetch",
                    api_provider="github",
                    latency_ms=latency_ms,
                    status="success" if profiles else "error",
                    campaign_id=campaign_id,
                    error_message=None if profiles else "PAT enrichment returned no profiles",
                )
            except Exception as exc:
                # 401 / fatal enrichment failure — fail the campaign visibly, never silent.
                write_log(
                    db,
                    event_type="github_profile_fetch",
                    api_provider="github",
                    latency_ms=0,
                    status="error",
                    campaign_id=campaign_id,
                    error_message=f"PAT enrichment failed: {exc}",
                )
                campaign.status = "error"
                campaign.completed_at = datetime.now(timezone.utc)
                db.commit()
                return
        else:
            profile_semaphore = asyncio.Semaphore(10)

            async def _fetch_with_semaphore(login: str) -> dict | None:
                async with profile_semaphore:
                    try:
                        start = time.monotonic()
                        profile = await fetch_github_profile(login, github_token)
                        latency_ms = int((time.monotonic() - start) * 1000)
                        _bg_write_log(
                            event_type="github_profile_fetch",
                            api_provider="github",
                            latency_ms=latency_ms,
                            status="success" if profile else "error",
                            campaign_id=campaign_id,
                            error_message=None if profile else f"Profile not found: {login}",
                        )
                        return profile
                    except Exception as exc:
                        _bg_write_log(
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

        # Guard: enrichment produced nothing usable → surface as error, never a silent
        # "complete with 0 candidates" (the original Dataset-stage failure mode).
        if not profiles:
            write_log(
                db,
                event_type="github_profile_fetch",
                api_provider="github",
                latency_ms=0,
                status="error",
                campaign_id=campaign_id,
                error_message="No profiles could be enriched from the discovered usernames.",
            )
            campaign.status = "error"
            campaign.completed_at = datetime.now(timezone.utc)
            db.commit()
            return

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
                    _bg_write_log(
                        event_type="outbound_profile_score",
                        api_provider="featherless",
                        latency_ms=latency_ms,
                        status="success",
                        campaign_id=campaign_id,
                    )
                    return {**profile, **result}
                except Exception as exc:
                    _bg_write_log(
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
