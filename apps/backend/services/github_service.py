"""
GitHub developer search and profile scoring using Bright Data SDK.
The Bright Data SDK (brightdata-sdk) wraps Bright Data's Web Scraper API with
async-native support and handles proxies, CAPTCHAs, and rate limiting.

Full implementation: Phase 8.
"""
import asyncio
from typing import Any
from config import settings


async def search_github_developers(
    signals: list[str],
    max_results: int = 20,
) -> list[dict[str, Any]]:
    """
    Search GitHub for developer profiles matching the given signals.
    Uses Bright Data SDK — requires BRIGHTDATA_API_KEY in .env.

    Args:
        signals: List of search terms (skills, languages, keywords)
        max_results: Max number of profiles to return

    Returns:
        List of raw profile dicts from Bright Data
    """
    if not settings.brightdata_api_key:
        raise RuntimeError("BRIGHTDATA_API_KEY not set — cannot search GitHub profiles")

    try:
        from brightdata import BrightDataClient  # type: ignore
    except ImportError:
        raise RuntimeError("brightdata-sdk not installed — run: pip install brightdata-sdk")

    profiles = []
    async with BrightDataClient(api_token=settings.brightdata_api_key) as client:
        for signal in signals[:5]:  # cap signals to avoid over-querying
            try:
                # Use Bright Data's GitHub scraper to search for developer profiles
                # matching each signal (language, framework, skill keyword)
                result = await client.scrape.github.search_users(
                    query=signal,
                    max_results=max_results // len(signals[:5]),
                )
                if result and result.data:
                    profiles.extend(result.data)
            except Exception:
                # Individual signal failure should not abort the whole search
                continue

    # Deduplicate by github_username
    seen = set()
    unique = []
    for p in profiles:
        username = p.get("login") or p.get("github_username", "")
        if username and username not in seen:
            seen.add(username)
            unique.append(p)

    return unique[:max_results]


async def fetch_github_profile(username: str) -> dict[str, Any]:
    """
    Fetch full GitHub profile for a given username via Bright Data SDK.
    Returns structured profile data.
    """
    if not settings.brightdata_api_key:
        raise RuntimeError("BRIGHTDATA_API_KEY not set")

    try:
        from brightdata import BrightDataClient  # type: ignore
    except ImportError:
        raise RuntimeError("brightdata-sdk not installed")

    async with BrightDataClient(api_token=settings.brightdata_api_key) as client:
        result = await client.scrape.github.user_profile(
            url=f"https://github.com/{username}"
        )
        return result.data if result else {}
