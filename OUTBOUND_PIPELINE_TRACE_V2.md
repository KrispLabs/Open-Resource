# Outbound Pipeline Trace V2

Generated: 2026-05-29
Campaign ID (run 1, pre-fix): 3447fb68-cca0-44bd-9d38-837d7f2d2dea
Campaign ID (run 2, post-fix): a2edbaec-50a8-4cc9-869a-38ad17d8c28a
Job ID: 9df1e4b9-26e0-406f-bb12-c9f656bb9106 (Senior Python Backend Engineer)

---

## Context: The Fix State

The `bright_data_service.py` file on disk was already patched with `urlencode`, but the
running backend (PID 78156, started before the patch) was serving the OLD unpatched code
from Python's module cache. The fix was not in effect for run 1. A backend restart was
required to activate it. Run 2 used the freshly started backend with the fix active.

---

## Step-by-Step Execution Trace

| # | Step | Component | Status | Notes |
|---|------|-----------|--------|-------|
| A | Signal extraction | Featherless AI → `extract_github_signals` | PASS | `search_queries` returned: `["language:python fastapi stars:>50", "language:python postgresql docker stars:>50", "language:python redis kubernetes aws celery stars:>50"]` |
| B | SERP search (query 1) | BrightData `/request` zone `serp_api2` | PASS (post-fix) | URL fix active: `q=site%3Agithub.com+language%3Apython+fastapi+stars%3A%3E50`. HTTP 200. 9 organic results, 1 profile extracted (`fastapi` org — not a real user profile). |
| B | SERP search (query 2) | BrightData `/request` zone `serp_api2` | PASS (post-fix) | HTTP 200. 8 organic results, 0 profiles extracted (all repo URLs like `github.com/user/repo`). |
| B | SERP search (query 3) | BrightData `/request` zone `serp_api2` | PASS (post-fix) | HTTP 200. 4 organic results, 0 profiles extracted. |
| B | Dedup | `run_outbound_campaign` | PASS | 1 unique login found: `['fastapi']` |
| C | Profile fetch (dataset trigger) | BrightData `datasets/v3/trigger` | **FAIL** | `POST https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_m794s4jrlq1bvkfnt` → HTTP **404** `"dataset does not exist"` |
| C | Profile fetch (error handling) | `fetch_profiles_dataset` | Silent fail | 404 caught by `except (TimeoutError, httpx.HTTPStatusError): return []`. Returns empty list. No error logged to system_logs or campaign status. |
| D | Profile scoring | `score_and_write_outreach` | NOT REACHED | `profiles = []`, loop skipped |
| E | Outreach generation | `score_and_write_outreach` | NOT REACHED | |
| F | DB persist | `OutboundCandidate` rows | NOT REACHED | `saved_count = 0` |
| G | Campaign finalize | `OutboundCampaign.status` | "complete" | Campaign marked complete with `total_found=0`, `total_contacted=0` — misleadingly successful status |

---

## First Failing Step (post URL-fix)

- **Step name:** Profile fetch — Bright Data GitHub profiles dataset trigger
- **File:** `apps/backend/services/bright_data_service.py`
- **Function:** `_trigger_and_poll`
- **Line:** ~53 (`resp.raise_for_status()` — raises `httpx.HTTPStatusError` on 404)
- **Exception:** `httpx.HTTPStatusError: Client error '404 Not Found' for url 'https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_m794s4jrlq1bvkfnt&include_errors=true&format=json'`
- **Root cause:** The dataset ID `gd_m794s4jrlq1bvkfnt` (set in `.env` as `BRIGHTDATA_DATASET_ID`) does not exist in the configured Bright Data account. The account credentials (`fec75259-f2dc-4a53-ae02-f748cdf48cb8`) are accepted by the SERP zone (`serp_api2`) but the dataset with that ID is either deleted, was never created, or belongs to a different account.
- **Confidence:** high

### Secondary issues discovered

1. **Silent failure swallows the 404.** `fetch_profiles_dataset` at line 181 catches `httpx.HTTPStatusError` and returns `[]` with no logging to `system_logs` and no escalation. The campaign finishes as `"complete"` with zero candidates, hiding the dataset error from the HR user and from the dev log viewer.

2. **dataset_id bypasses provider_manager.** `run_outbound_campaign` at line 403 reads `settings.brightdata_dataset_id` directly instead of reading from `provider_manager.get("brightdata")`. All other Bright Data config fields (api_key, serp_zone) correctly use `provider_manager` first. This means the dataset ID cannot be overridden via the Dev portal `/api/providers/configure` endpoint.

3. **SERP profile extraction yield is very low.** The SERP queries use GitHub search syntax (`language:python fastapi stars:>50`) which Google returns as repository and topic pages, not user profile pages. Across 21 organic results total (3 queries), only 1 profile URL matched the regex `github.com/{username}/$` — and that was the `fastapi` *organization* page, not an individual developer. The regex correctly rejects repo URLs (`github.com/user/repo`), but GitHub search syntax inherently surfaces repos over profiles on Google.

---

## Working Components

| Component | Status | Evidence |
|-----------|--------|---------|
| JWT auth / login | Working | HTTP 200 on `POST /auth/login` |
| Job creation + JD analysis | Working | Stage 1 Featherless call → `jd_parsed` with `must_have_skills`, `proposed_weights` |
| Signal extraction (Step A) | Working | Featherless returns valid JSON with `search_queries` array |
| BrightData SERP `/request` (Step B) | Working post-fix | HTTP 200 after URL encoding fix applied; organic results parsed correctly |
| URL regex filter | Working | Correctly excludes `github.com/user/repo` two-segment URLs; reserved usernames blocked |
| Campaign creation endpoint | Working | Returns `campaign_id` and status `"running"` |
| Campaign polling endpoint | Working | Returns campaign with `github_search_signals` populated after signals step |
| Backend startup + DB seeding | Working | All tables created, providers migrated from env |

---

## Broken Components

| Component | Status | Evidence |
|-----------|--------|---------|
| BrightData dataset API (Step C) | **Broken — dataset not found** | `POST /datasets/v3/trigger?dataset_id=gd_m794s4jrlq1bvkfnt` → HTTP 404 `"dataset does not exist"` |
| Error reporting for dataset 404 | **Broken — silent failure** | No `system_logs` entry written, no campaign error status, no user-visible message |
| dataset_id in provider_manager | **Missing** | `settings.brightdata_dataset_id` used directly, bypassing provider_manager |
| Profile yield from SERP | **Effectively broken** | GitHub search syntax queries return repo pages on Google; only 1 org-profile URL extracted across 3 queries; no real developer profiles |
| Steps D–G (scoring, outreach, DB persist) | **Never reached** | Upstream failure at Step C means `profiles = []` on every run |

---

## Raw Log Evidence

### Run 1 (pre-fix, stale backend — URL encoding not applied):
```
INFO:services.bright_data_service:[brightdata_serp] REQUEST endpoint=https://api.brightdata.com/request zone=serp_api2 search_url=https://www.google.com/search?q=site:github.com+language:python+fastapi+stars:>50
INFO:httpx:HTTP Request: POST https://api.brightdata.com/request "HTTP/1.1 400 Bad Request"
INFO:services.bright_data_service:[brightdata_serp] RESPONSE status=400 ... body_preview='{"error":"Request validation failed","error_code":"validation","details":[{"message":"\\"url\\" must be a valid uri","path":["url"],"type":"string.uri","context":{"label":"url","value":"https://www.google.com/search?q=site:github.com+language:python+fastapi+stars:>50","key":"url"}}]}'
```

### Run 2 (post-fix, fresh backend — URL encoding active):
```
INFO:services.bright_data_service:[brightdata_serp] REQUEST raw_query='language:python fastapi stars:>50' encoded_url=https://www.google.com/search?q=site%3Agithub.com+language%3Apython+fastapi+stars%3A%3E50 zone=serp_api2
INFO:httpx:HTTP Request: POST https://api.brightdata.com/request "HTTP/1.1 200 OK"
INFO:services.bright_data_service:[brightdata_serp] PARSED organic_results=9
INFO:services.bright_data_service:[brightdata_serp] EXTRACTED profiles=1 logins=['fastapi']
INFO:services.bright_data_service:[brightdata_serp] REQUEST raw_query='language:python postgresql docker stars:>50' encoded_url=https://www.google.com/search?q=site%3Agithub.com+language%3Apython+postgresql+docker+stars%3A%3E50 zone=serp_api2
INFO:httpx:HTTP Request: POST https://api.brightdata.com/request "HTTP/1.1 200 OK"
INFO:services.bright_data_service:[brightdata_serp] PARSED organic_results=8
INFO:services.bright_data_service:[brightdata_serp] EXTRACTED profiles=0 logins=[]
INFO:services.bright_data_service:[brightdata_serp] REQUEST raw_query='language:python redis kubernetes aws celery stars:>50' encoded_url=https://www.google.com/search?q=site%3Agithub.com+language%3Apython+redis+kubernetes+aws+celery+stars%3A%3E50 zone=serp_api2
INFO:httpx:HTTP Request: POST https://api.brightdata.com/request "HTTP/1.1 200 OK"
INFO:services.bright_data_service:[brightdata_serp] PARSED organic_results=4
INFO:services.bright_data_service:[brightdata_serp] EXTRACTED profiles=0 logins=[]
INFO:services.github_service:[outbound] users_found_total=1 logins=['fastapi']
INFO:httpx:HTTP Request: POST https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_m794s4jrlq1bvkfnt&include_errors=true&format=json "HTTP/1.1 404 Not Found"
INFO:services.github_service:[outbound] brightdata_profiles requested=1 returned=0
```

### Direct confirmation (tested via Python):
```
POST https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_m794s4jrlq1bvkfnt
status: 404
body: "dataset does not exist"
```

---

## Recommended Fixes

### Fix 1 — Create or correct the Bright Data dataset ID (blocker)
The `BRIGHTDATA_DATASET_ID=gd_m794s4jrlq1bvkfnt` in `.env` points to a non-existent dataset.
Options:
- (a) Log into the Bright Data console, create a GitHub Profiles dataset, copy the real dataset ID, and update `.env`.
- (b) Set `BRIGHTDATA_DATASET_ID=` (empty) and `BRIGHTDATA_API_KEY=` (empty) to force the GitHub REST API fallback path, which doesn't require a dataset.

### Fix 2 — Log dataset failures to system_logs and set campaign to "error"
In `fetch_profiles_dataset` (`apps/backend/services/bright_data_service.py` line 181),
the `except (TimeoutError, httpx.HTTPStatusError)` silently returns `[]`.
The caller in `run_outbound_campaign` at line 415 logs `status="success" if profiles else "error"` but only writes to `system_logs`, not to `campaign.status`. A 404 on the dataset should set `campaign.status = "error"` so HR users know the sourcing failed.

### Fix 3 — Read dataset_id from provider_manager
In `run_outbound_campaign` (`apps/backend/services/github_service.py` line 403),
replace:
```python
settings.brightdata_dataset_id,
```
with:
```python
brightdata_cfg.get("dataset_id") or settings.brightdata_dataset_id,
```
This makes the dataset ID configurable from the Dev portal without a restart.

### Fix 4 — Improve SERP query strategy for finding developer profiles (non-blocker)
The current queries use GitHub search syntax (`language:python fastapi stars:>50`).
Google does not index these as user profile pages. Consider using free-text queries like
`"python developer" fastapi github.com` or `site:github.com/users python fastapi`
to increase profile URL yield from SERP results.
