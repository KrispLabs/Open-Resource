"""
Bright Data service layer — replaces direct GitHub REST API calls in the
outbound sourcing pipeline when BRIGHTDATA_API_KEY is configured.

Two public functions mirror the signatures of their GitHub REST equivalents:
  search_candidates_serp    ←→  search_github_users
  fetch_profiles_dataset    ←→  fetch_github_profile (but batched)

If BRIGHTDATA_API_KEY is empty the pipeline falls back to GitHub REST; these
functions are never called in that case.
"""
import asyncio
import logging
import re
import httpx

_log = logging.getLogger(__name__)

BRIGHTDATA_API_BASE = "https://api.brightdata.com"
POLL_INTERVAL = 2.0   # seconds between snapshot poll attempts
PROFILE_TIMEOUT = 120.0  # max seconds to wait for profile dataset


def _bd_headers(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


async def _trigger_and_poll(
    api_key: str,
    dataset_id: str,
    payload: list[dict],
    timeout: float,
) -> list[dict]:
    """
    Trigger a Bright Data dataset collection and poll until the snapshot is ready.
    Returns the list of result records, or raises on timeout / HTTP error.
    """
    trigger_url = (
        f"{BRIGHTDATA_API_BASE}/datasets/v3/trigger"
        f"?dataset_id={dataset_id}&include_errors=true&format=json"
    )

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(trigger_url, headers=_bd_headers(api_key), json=payload)
        if resp.status_code == 401:
            raise ValueError("Bright Data: invalid API key (401)")
        if resp.status_code == 429:
            raise ValueError("Bright Data: rate limit reached (429)")
        resp.raise_for_status()
        snapshot_id = resp.json().get("snapshot_id", "")

    if not snapshot_id:
        raise ValueError("Bright Data: trigger response missing snapshot_id")

    snapshot_url = (
        f"{BRIGHTDATA_API_BASE}/datasets/v3/snapshot/{snapshot_id}?format=json"
    )
    elapsed = 0.0
    async with httpx.AsyncClient(timeout=30.0) as client:
        while elapsed < timeout:
            poll_resp = await client.get(snapshot_url, headers=_bd_headers(api_key))
            if poll_resp.status_code == 200:
                data = poll_resp.json()
                return data if isinstance(data, list) else []
            if poll_resp.status_code != 202:
                poll_resp.raise_for_status()
            await asyncio.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL

    raise TimeoutError(f"Bright Data snapshot {snapshot_id} not ready after {timeout}s")


async def search_candidates_serp(
    query: str,
    api_key: str,
    serp_zone: str = "serp_api2",
) -> list[dict]:
    """
    Search for GitHub developer profiles via the Bright Data Web Access SERP API.
    Uses the synchronous /request endpoint (no trigger/poll needed).
    Returns [{login, avatar_url, html_url}].
    """
    import json as _json

    search_url = f"https://www.google.com/search?q=site:github.com+{query.replace(' ', '+')}"
    body = {"zone": serp_zone, "url": search_url, "format": "json"}
    endpoint = f"{BRIGHTDATA_API_BASE}/request"

    _log.info(
        "[brightdata_serp] REQUEST endpoint=%s zone=%s search_url=%s payload_keys=%s",
        endpoint, serp_zone, search_url, list(body.keys()),
    )

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                endpoint,
                headers=_bd_headers(api_key),
                json=body,
            )

            # Capture full diagnostic info before raise_for_status discards the body
            _log.info(
                "[brightdata_serp] RESPONSE status=%d headers=%s body_preview=%r",
                resp.status_code,
                dict(resp.headers),
                resp.text[:2000],
            )

            if resp.status_code == 407:
                raise ValueError(f"Bright Data SERP: zone '{serp_zone}' not found or auth failed")
            resp.raise_for_status()
            outer = resp.json()

        # Response: {"status_code": 200, "body": "<json string>"}
        raw_body = outer.get("body", "{}")
        inner = _json.loads(raw_body) if isinstance(raw_body, str) else raw_body
        organic: list[dict] = inner.get("organic", [])

    except (ValueError, httpx.HTTPStatusError) as exc:
        # Propagate auth/zone errors so the caller can set campaign status to error
        raise
    except _json.JSONDecodeError:
        return []

    candidates: list[dict] = []
    seen: set[str] = set()

    for item in organic:
        link: str = item.get("link") or item.get("url") or ""
        # Match github.com/{username} only — exclude /username/repo paths
        m = re.match(r"https?://(?:www\.)?github\.com/([^/?#]+)/?$", link)
        if not m:
            continue
        login = m.group(1)
        if login.lower() in {"features", "topics", "explore", "marketplace", "about", "pricing", "orgs"}:
            continue
        if login in seen:
            continue
        seen.add(login)
        candidates.append({
            "login": login,
            "avatar_url": "",
            "html_url": f"https://github.com/{login}",
        })

    return candidates


async def fetch_profiles_dataset(
    usernames: list[str],
    api_key: str,
    dataset_id: str,
) -> list[dict]:
    """
    Fetch enriched GitHub profiles via the Bright Data GitHub profiles dataset.
    Batched — one trigger call for all usernames.
    Equivalent (but batched) to fetch_github_profile.

    Returns a list of profile dicts; profiles that fail (404 / error key) are skipped.
    """
    if not usernames:
        return []

    payload = [{"url": f"https://github.com/{u}"} for u in usernames]

    try:
        records = await _trigger_and_poll(api_key, dataset_id, payload, PROFILE_TIMEOUT)
    except (TimeoutError, httpx.HTTPStatusError):
        return []

    profiles: list[dict] = []
    for item in records:
        # Skip error records (profile not found, private, suspended)
        if "error" in item or not item.get("id"):
            continue

        # Collect unique non-None languages from top_repositories (max 5)
        top_repos_raw = item.get("top_repositories") or item.get("repositories", [])
        languages_seen: list[str] = []
        notable_repos: list[dict] = []
        for repo in top_repos_raw[:5]:
            lang = repo.get("language")
            if lang and lang not in languages_seen:
                languages_seen.append(lang)
            notable_repos.append({
                "name": repo.get("name", ""),
                "stars": repo.get("stars_count") or repo.get("stargazers_count", 0),
                "description": repo.get("description", ""),
                "language": lang or "",
            })

        login = item.get("id") or item.get("username") or item.get("login", "")
        profiles.append({
            "login": login,
            "name": item.get("name"),
            "bio": item.get("bio"),
            "location": item.get("location"),
            "followers": item.get("followers_count") or item.get("followers", 0),
            "public_repos": item.get("public_repos", 0),
            "avatar_url": item.get("avatar") or item.get("avatar_url", ""),
            "html_url": item.get("url") or f"https://github.com/{login}",
            "top_languages": languages_seen[:5],
            "notable_repos": notable_repos[:5],
        })

    return profiles
