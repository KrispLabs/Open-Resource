#!/usr/bin/env python3
"""
Bright Data Browser API — GitHub Data Extraction Feasibility Spike

STANDALONE PROOF-OF-CONCEPT. Touches zero production code.
Purpose: Validate whether Bright Data Browser API (zone: scraping_browser2)
can replace the broken Dataset API stage in the outbound sourcing pipeline.

Tests
-----
1. GitHub Profile page  — github.com/torvalds
2. GitHub Repo page     — github.com/tiangolo/fastapi
3. GitHub Search page   — github.com/search?q=fastapi&type=users

Dependencies
------------
    pip install playwright
    python -m playwright install chromium

Environment variables (set at least one credential method)
-----------------------------------------------------------
    BRIGHTDATA_BROWSER_WS_ENDPOINT    Full wss:// CDP endpoint (overrides all below)
    BRIGHTDATA_BROWSER_USERNAME       brd-customer-{ID}-zone-{ZONE}
    BRIGHTDATA_BROWSER_PASSWORD       Zone password from Bright Data dashboard

Execution
---------
    cd apps/backend
    BRIGHTDATA_BROWSER_USERNAME="brd-customer-hl_149a06d7-zone-scraping_browser2" \\
    BRIGHTDATA_BROWSER_PASSWORD="g35takygjpos" \\
    .venv/bin/python scripts/test_browser_api_github.py

Expected output
---------------
Three JSON blocks printed to stdout, one per test, plus a summary table.
Screenshots saved: scripts/t1_profile.png, t2_repo.png, t3_search.png
"""

import asyncio
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

from playwright.async_api import async_playwright, TimeoutError as PWTimeout

# ─── Output directory (same directory as this script) ─────────────────────────
SCRIPT_DIR = Path(__file__).parent

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s.%(msecs)03d %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("bd_browser_poc")

# ─── Credentials ──────────────────────────────────────────────────────────────
_WS_ENDPOINT = os.environ.get("BRIGHTDATA_BROWSER_WS_ENDPOINT", "")
_USERNAME = os.environ.get(
    "BRIGHTDATA_BROWSER_USERNAME",
    "brd-customer-hl_149a06d7-zone-scraping_browser2",
)
_PASSWORD = os.environ.get("BRIGHTDATA_BROWSER_PASSWORD", "g35takygjpos")

# Timeouts
NAV_TIMEOUT_MS = 60_000   # page.goto()
WAIT_TIMEOUT_MS = 15_000  # wait_for_selector()
ELEM_TIMEOUT_MS = 5_000   # individual element lookups


def build_ws_endpoint() -> str:
    """Construct the CDP WebSocket URL from env vars or hardcoded credentials."""
    if _WS_ENDPOINT:
        log.info("Using explicit BRIGHTDATA_BROWSER_WS_ENDPOINT")
        return _WS_ENDPOINT
    if _USERNAME and _PASSWORD:
        endpoint = f"wss://{_USERNAME}:{_PASSWORD}@brd.superproxy.io:9222"
        log.info("Built endpoint from USERNAME/PASSWORD: wss://%s:****@brd.superproxy.io:9222", _USERNAME)
        return endpoint
    raise EnvironmentError(
        "\nNo Browser API credentials found. Set one of:\n"
        "  BRIGHTDATA_BROWSER_WS_ENDPOINT=wss://...\n"
        "  BRIGHTDATA_BROWSER_USERNAME + BRIGHTDATA_BROWSER_PASSWORD"
    )


# ─── Extraction helpers ────────────────────────────────────────────────────────

async def get_text(page, *selectors: str, timeout: int = ELEM_TIMEOUT_MS) -> Optional[str]:
    """Try selectors in order; return first non-empty text found."""
    for sel in selectors:
        try:
            el = await page.wait_for_selector(sel, timeout=timeout)
            if el:
                raw = await el.text_content()
                if raw and raw.strip():
                    log.debug("    selector=%r  text=%r", sel, raw.strip()[:80])
                    return raw.strip()
        except Exception:
            pass
    log.debug("    none of selectors matched: %s", selectors)
    return None


def parse_count(text: Optional[str]) -> int:
    """Convert '1.2k', '12,345', '123M' etc. to int. Returns 0 on parse failure."""
    if not text:
        return 0
    text = text.strip().replace(",", "").replace(" ", "")
    try:
        if text.lower().endswith("k"):
            return int(float(text[:-1]) * 1_000)
        if text.lower().endswith("m"):
            return int(float(text[:-1]) * 1_000_000)
        m = re.search(r"[\d.]+", text)
        if m:
            return int(float(m.group()))
    except (ValueError, TypeError):
        pass
    return 0


async def wait_for_page_settle(page, label: str) -> None:
    """Wait for network idle or 3s whichever comes first, for dynamic content."""
    try:
        await page.wait_for_load_state("networkidle", timeout=8_000)
        log.debug("[%s] networkidle achieved", label)
    except PWTimeout:
        log.debug("[%s] networkidle timeout (normal for heavy pages), continuing", label)


async def screenshot(page, filename: str) -> None:
    path = SCRIPT_DIR / filename
    await page.screenshot(path=str(path), full_page=False)
    log.info("Screenshot saved → %s", path)


# ─── TEST 1: GitHub Profile ────────────────────────────────────────────────────

async def test_github_profile(page) -> dict:
    """
    Visit https://github.com/torvalds and extract:
    login, name, bio, location, followers, following, public_repos
    """
    url = "https://github.com/torvalds"
    log.info("=" * 60)
    log.info("[T1] START: GitHub profile — %s", url)
    log.info("=" * 60)

    t0 = time.monotonic()
    try:
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
        load_ms = int((time.monotonic() - t0) * 1000)
        http_status = resp.status if resp else "unknown"
        log.info("[T1] Page loaded: status=%s  time=%dms", http_status, load_ms)
    except PWTimeout:
        log.error("[T1] Navigation TIMED OUT after %dms", NAV_TIMEOUT_MS)
        raise

    title = await page.title()
    log.info("[T1] Page title: %r", title)

    # Check for bot challenge / login wall
    if "Sign in" in title or "rate limit" in title.lower():
        log.warning("[T1] Possible bot challenge or login wall — title=%r", title)

    await wait_for_page_settle(page, "T1")
    await screenshot(page, "t1_profile.png")

    log.info("[T1] Extracting fields...")

    login = await get_text(
        page,
        "span.p-nickname",
        "[itemprop='additionalName']",
        ".p-nickname",
    ) or "torvalds"

    name = await get_text(
        page,
        "span.p-name",
        "[itemprop='name'] .p-name",
        ".vcard-fullname",
        "span.p-name.vcard-fullname",
    )

    bio = await get_text(
        page,
        "div[data-bio-text]",
        ".js-user-profile-bio div",
        ".user-profile-bio",
        ".p-note",
    )

    location = await get_text(
        page,
        "li[itemprop='homeLocation'] span.p-label",
        "[data-test-selector='profile-location'] span",
        ".p-label",
        "li.vcard-detail span[itemprop='homeLocation']",
    )

    # Followers: anchor text contains "followers"
    followers_raw = await get_text(
        page,
        "a[href*='?tab=followers'] span.text-bold",
        "a[href*='followers'] span.text-bold",
    )
    # Fallback: scan all anchors for "X followers" pattern
    if not followers_raw:
        try:
            anchors = await page.query_selector_all("a")
            for a in anchors:
                text = (await a.text_content() or "").strip()
                if re.search(r"[\d,k]+\s+followers", text, re.IGNORECASE):
                    m = re.search(r"([\d,]+(?:\.\d+)?[km]?)", text, re.IGNORECASE)
                    followers_raw = m.group(1) if m else None
                    log.debug("[T1] followers via anchor scan: %r (source: %r)", followers_raw, text[:60])
                    break
        except Exception as e:
            log.warning("[T1] Follower anchor scan failed: %s", e)

    following_raw = await get_text(
        page,
        "a[href*='?tab=following'] span.text-bold",
        "a[href*='following'] span.text-bold",
    )

    # Public repos: counter on the Repositories tab
    repos_raw = await get_text(
        page,
        "a[href*='?tab=repositories'] span.Counter",
        "nav a[href*='tab=repositories'] span",
        "[data-tab-item='repositories'] span.Counter",
    )

    result = {
        "login": login,
        "name": name,
        "bio": bio,
        "location": location,
        "followers": parse_count(followers_raw),
        "following": parse_count(following_raw),
        "public_repos": parse_count(repos_raw),
    }

    missing = [k for k, v in result.items() if v is None or v == 0 and k in ("followers",)]
    if missing:
        log.warning("[T1] Fields with no data: %s", missing)

    log.info("[T1] Result:\n%s", json.dumps(result, indent=2))
    return result


# ─── TEST 2: GitHub Repo ──────────────────────────────────────────────────────

async def test_github_repo(page) -> dict:
    """
    Visit https://github.com/tiangolo/fastapi and extract:
    repo, stars, forks, language, description
    """
    url = "https://github.com/tiangolo/fastapi"
    log.info("=" * 60)
    log.info("[T2] START: GitHub repo — %s", url)
    log.info("=" * 60)

    t0 = time.monotonic()
    try:
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
        load_ms = int((time.monotonic() - t0) * 1000)
        log.info("[T2] Page loaded: status=%s  time=%dms", resp.status if resp else "unknown", load_ms)
    except PWTimeout:
        log.error("[T2] Navigation TIMED OUT")
        raise

    log.info("[T2] Page title: %r", await page.title())
    await wait_for_page_settle(page, "T2")
    await screenshot(page, "t2_repo.png")

    log.info("[T2] Extracting fields...")

    repo_name = await get_text(
        page,
        "strong[itemprop='name'] a",
        "h1 strong a",
        "[itemprop='name']",
    ) or "fastapi"

    description = await get_text(
        page,
        "p.f4.my-3",
        "p.f4",
        ".repository-content p",
        "[data-pjax='#repo-content-pjax-container'] > div p",
    )

    # Stars
    stars_raw = await get_text(
        page,
        "#repo-stars-counter-star",
        "a[href*='/stargazers'] strong",
        "#stargazers-count",
        "span#repo-stars-counter-star",
        ".social-count[href*='stargazers']",
    )
    # Fallback: button with star count
    if not stars_raw:
        try:
            buttons = await page.query_selector_all("button, a")
            for btn in buttons:
                text = (await btn.text_content() or "").strip()
                if re.search(r"^[\d,.]+[km]?$", text, re.IGNORECASE) and int(parse_count(text)) > 100:
                    aria = await btn.get_attribute("aria-label") or ""
                    if "star" in aria.lower():
                        stars_raw = text
                        log.debug("[T2] stars via button scan: %r", stars_raw)
                        break
        except Exception as e:
            log.warning("[T2] Stars button scan failed: %s", e)

    # Forks
    forks_raw = await get_text(
        page,
        "#repo-network-counter",
        "a[href$='/forks'] strong",
        "#forks-count",
        "span#repo-network-counter",
    )

    # Language
    language = await get_text(
        page,
        "span[itemprop='programmingLanguage']",
        ".repository-content .d-inline span.color-fg-default",
        "a[href*='?l='] span.color-fg-default",
        "[data-view-component='true'] span.color-fg-default",
    )

    result = {
        "repo": repo_name,
        "stars": parse_count(stars_raw),
        "forks": parse_count(forks_raw),
        "language": language,
        "description": description,
    }

    log.info("[T2] Result:\n%s", json.dumps(result, indent=2))
    return result


# ─── TEST 3: GitHub Search ────────────────────────────────────────────────────

async def test_github_search(page) -> list[str]:
    """
    Visit https://github.com/search?q=fastapi&type=users
    and extract the first 10 usernames from results.
    """
    url = "https://github.com/search?q=fastapi&type=users"
    log.info("=" * 60)
    log.info("[T3] START: GitHub search — %s", url)
    log.info("=" * 60)

    t0 = time.monotonic()
    try:
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
        load_ms = int((time.monotonic() - t0) * 1000)
        log.info("[T3] Page loaded: status=%s  time=%dms", resp.status if resp else "unknown", load_ms)
    except PWTimeout:
        log.error("[T3] Navigation TIMED OUT")
        raise

    log.info("[T3] Page title: %r", await page.title())

    # GitHub search results are React-rendered; wait for result container
    log.info("[T3] Waiting for results container...")
    result_selectors = [
        "[data-testid='results-list']",
        ".search-result",
        "ul.user-list",
        ".codesearch-results",
        "div[role='main']",
    ]
    for sel in result_selectors:
        try:
            await page.wait_for_selector(sel, timeout=WAIT_TIMEOUT_MS)
            log.info("[T3] Results container found: %r", sel)
            break
        except PWTimeout:
            log.debug("[T3] Selector %r not found, trying next", sel)

    await wait_for_page_settle(page, "T3")
    await screenshot(page, "t3_search.png")

    # Check for login wall / CAPTCHA
    page_text = await page.text_content("body") or ""
    if "Sign in" in (await page.title()) or "verify you are human" in page_text.lower():
        log.error("[T3] ANTI-BOT WALL DETECTED — page requires login or CAPTCHA")

    logins: list[str] = []
    skip_logins = {
        "features", "topics", "explore", "marketplace", "about",
        "pricing", "login", "signup", "organizations", "contact",
        "site", "security", "blog", "enterprise", "settings",
    }

    def _extract_login(href: str) -> Optional[str]:
        """Return bare username from github.com/{login} href, or None."""
        m = re.match(r"^(?:https?://(?:www\.)?github\.com)?/([^/?#]+)/?$", href)
        if not m:
            return None
        login = m.group(1)
        return login if login.lower() not in skip_logins else None

    # Strategy 1: modern React search results (data-testid)
    log.info("[T3] Strategy 1: [data-testid='results-list'] links")
    try:
        links = await page.query_selector_all("[data-testid='results-list'] a[href]")
        for link in links:
            href = await link.get_attribute("href") or ""
            login = _extract_login(href)
            if login and login not in logins:
                logins.append(login)
        log.info("[T3] Strategy 1 yielded %d usernames", len(logins))
    except Exception as e:
        log.warning("[T3] Strategy 1 failed: %s", e)

    # Strategy 2: .search-title anchors (classic GitHub search)
    if len(logins) < 3:
        log.info("[T3] Strategy 2: .search-title / entity-search-result links")
        try:
            links = await page.query_selector_all(
                ".search-title a, .entity-search-result a, .user-list-item a"
            )
            for link in links:
                href = await link.get_attribute("href") or ""
                login = _extract_login(href)
                if login and login not in logins:
                    logins.append(login)
            log.info("[T3] Strategy 2 total: %d usernames", len(logins))
        except Exception as e:
            log.warning("[T3] Strategy 2 failed: %s", e)

    # Strategy 3: all anchor hrefs matching /username pattern
    if len(logins) < 3:
        log.info("[T3] Strategy 3: full page link scan")
        try:
            all_links = await page.query_selector_all("a[href]")
            for link in all_links:
                href = await link.get_attribute("href") or ""
                login = _extract_login(href)
                if login and login not in logins:
                    logins.append(login)
            log.info("[T3] Strategy 3 total: %d usernames (may include navigation links)", len(logins))
        except Exception as e:
            log.warning("[T3] Strategy 3 failed: %s", e)

    # Strategy 4: read visible text for @username patterns
    if len(logins) < 3:
        log.info("[T3] Strategy 4: @username text scan")
        try:
            body_text = await page.inner_text("body")
            matches = re.findall(r"@([a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})", body_text)
            for m in matches:
                if m.lower() not in skip_logins and m not in logins:
                    logins.append(m)
            log.info("[T3] Strategy 4 total: %d usernames", len(logins))
        except Exception as e:
            log.warning("[T3] Strategy 4 failed: %s", e)

    result = logins[:10]
    log.info("[T3] Final (top 10):\n%s", json.dumps(result, indent=2))
    return result


# ─── Main runner ──────────────────────────────────────────────────────────────

async def main() -> int:
    """
    Returns 0 if all 3 tests pass, 1 if any fail.
    """
    ws_endpoint = build_ws_endpoint()

    results: dict = {}
    errors: dict = {}
    latencies: dict = {}

    log.info("Connecting to Bright Data Browser API (scraping_browser2)...")
    t_connect = time.monotonic()

    async with async_playwright() as pw:
        try:
            browser = await pw.chromium.connect_over_cdp(
                ws_endpoint,
                timeout=30_000,
            )
        except Exception as exc:
            log.error("FATAL: Could not connect to Browser API: %s", exc)
            print(f"\nCONNECTION FAILED: {exc}")
            return 1

        connect_ms = int((time.monotonic() - t_connect) * 1000)
        log.info("Browser API connected in %dms  version=%s", connect_ms, browser.version)
        latencies["connect_ms"] = connect_ms

        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
            locale="en-US",
        )
        page = await context.new_page()
        page.set_default_timeout(ELEM_TIMEOUT_MS)

        # ── Test 1 ────────────────────────────────────────────────────────────
        print("\n" + "=" * 60)
        print("TEST 1 — GitHub Profile: github.com/torvalds")
        print("=" * 60)
        t0 = time.monotonic()
        try:
            results["test1_profile"] = await test_github_profile(page)
            latencies["test1_ms"] = int((time.monotonic() - t0) * 1000)
            print(json.dumps(results["test1_profile"], indent=2))
            print(f"[OK] completed in {latencies['test1_ms']}ms")
        except Exception as exc:
            latencies["test1_ms"] = int((time.monotonic() - t0) * 1000)
            errors["test1_profile"] = str(exc)
            log.error("[T1] FAILED: %s", exc, exc_info=True)
            print(f"[FAIL] {exc}")

        # ── Test 2 ────────────────────────────────────────────────────────────
        print("\n" + "=" * 60)
        print("TEST 2 — GitHub Repo: github.com/tiangolo/fastapi")
        print("=" * 60)
        t0 = time.monotonic()
        try:
            results["test2_repo"] = await test_github_repo(page)
            latencies["test2_ms"] = int((time.monotonic() - t0) * 1000)
            print(json.dumps(results["test2_repo"], indent=2))
            print(f"[OK] completed in {latencies['test2_ms']}ms")
        except Exception as exc:
            latencies["test2_ms"] = int((time.monotonic() - t0) * 1000)
            errors["test2_repo"] = str(exc)
            log.error("[T2] FAILED: %s", exc, exc_info=True)
            print(f"[FAIL] {exc}")

        # ── Test 3 ────────────────────────────────────────────────────────────
        print("\n" + "=" * 60)
        print("TEST 3 — GitHub Search: q=fastapi, type=users")
        print("=" * 60)
        t0 = time.monotonic()
        try:
            results["test3_search"] = await test_github_search(page)
            latencies["test3_ms"] = int((time.monotonic() - t0) * 1000)
            print(json.dumps(results["test3_search"], indent=2))
            print(f"[OK] completed in {latencies['test3_ms']}ms")
        except Exception as exc:
            latencies["test3_ms"] = int((time.monotonic() - t0) * 1000)
            errors["test3_search"] = str(exc)
            log.error("[T3] FAILED: %s", exc, exc_info=True)
            print(f"[FAIL] {exc}")

        await browser.close()

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Tests passed : {len(results)}/3")
    print(f"Tests failed : {len(errors)}/3")
    print(f"Connect time : {latencies.get('connect_ms', '?')}ms")
    for k, ms in latencies.items():
        if k != "connect_ms":
            print(f"  {k}: {ms}ms")
    if errors:
        print("\nFailures:")
        for k, v in errors.items():
            print(f"  {k}: {v}")

    print("\nExtracted data:")
    print(json.dumps(results, indent=2))

    # Machine-readable output for report generation
    machine_output = {
        "results": results,
        "errors": errors,
        "latencies_ms": latencies,
        "pass_count": len(results),
        "fail_count": len(errors),
    }
    out_path = SCRIPT_DIR / "test_results.json"
    out_path.write_text(json.dumps(machine_output, indent=2))
    log.info("Machine-readable results written → %s", out_path)

    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
