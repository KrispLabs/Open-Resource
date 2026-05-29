# Outbound Sourcing V3 — Architecture Document

**Classification:** Internal Engineering Reference  
**Status:** Proposed  
**Date:** 2026-05-29  
**Author:** Principal Staff Engineer Review

---

## 1. Executive Summary

Outbound sourcing is 80% functional. The Bright Data SERP search, Featherless AI signal extraction, AI profile scoring, and outreach generation all work correctly. A single missing configuration — a Bright Data Dataset ID (`gd_m794s4jrlq1bvkfnt`) that resolves to 404 on the current account — silently blocks every campaign, producing `total_found = 0` while all upstream and downstream stages succeed.

**V3 replaces the broken Dataset stage with Bright Data Web Unlocker** — a product already available on the account — routing requests to the GitHub REST API (`api.github.com`). The response schema is structurally identical to the existing `fetch_github_profile()` fallback, meaning the adapter layer is a single function swap with zero changes to the scoring engine, ranking engine, or outreach writer.

**Expected outcome:** End-to-end campaigns producing 10–30 scored, ranked candidates with personalized outreach emails, fully operational for demo on current credits (~$249).

---

## 2. Current System Analysis

### 2.1 Working Stages

| Stage | Service | Function | Status |
|-------|---------|----------|--------|
| Signal Extraction | Featherless AI | `extract_github_signals()` | ✅ Working |
| Candidate Discovery | Bright Data SERP | `search_candidates_serp()` | ✅ Working |
| Profile Scoring | Featherless AI | `score_and_write_outreach()` | ✅ Working |
| Candidate Persistence | SQLite | `OutboundCandidate` model | ✅ Working |
| Campaign Orchestration | FastAPI background task | `run_outbound_campaign()` | ✅ Working |

### 2.2 Broken Stage

| Stage | Service | Function | Status |
|-------|---------|----------|--------|
| Profile Enrichment | Bright Data Dataset | `fetch_profiles_dataset()` | ❌ 404 |

### 2.3 Failure Mechanics

When `use_brightdata = True`, the pipeline calls `fetch_profiles_dataset()` with `dataset_id = "gd_m794s4jrlq1bvkfnt"`.

```
POST /datasets/v3/trigger?dataset_id=gd_m794s4jrlq1bvkfnt
→ 404 Dataset Not Found
```

The function returns `[]`. Because `profiles = []`, the scoring loop produces zero results. `campaign.total_found = 0`. No error is surfaced — the campaign status is set to `"complete"` with an invisible zero.

The code path at `github_service.py:418` logs `"No profiles returned from Bright Data dataset"` as status `"error"`, but the campaign still transitions to `"complete"` at line 522. From the HR portal's perspective, a successful campaign with no candidates is indistinguishable from a pipeline failure.

### 2.4 Installed Bright Data SDK Capabilities

Bright Data SDK v2.0.0 is installed. Available services in the current environment:

- **SERP API** — `/request` endpoint with SERP zone — ✅ Currently wired and working
- **Web Unlocker** — `/request` endpoint with unlocker zone — ✅ Available, not yet wired
- **Browser API** — Playwright-based JS rendering — ✅ Available, not wired
- **Dataset API** — `/datasets/v3/trigger` — ❌ Dataset ID invalid on this account

---

## 3. Root Cause Analysis

### Primary Cause
The Bright Data account used for this project does not have a licensed GitHub Profiles dataset. Dataset IDs are account-scoped — `gd_m794s4jrlq1bvkfnt` may refer to a dataset on a different account, a trial dataset that expired, or a dataset that was never provisioned on this account.

### Contributing Cause
The failure mode is silent. `fetch_profiles_dataset()` swallows `TimeoutError` and `HTTPStatusError` exceptions, returning `[]`. The campaign runner treats an empty profile list the same as a completed campaign with no candidates. There is no error propagation from the dataset stage to the campaign status.

### Why Not Just Fix the Dataset ID
Acquiring a valid Bright Data GitHub Profiles dataset requires:
1. Purchasing a Dataset subscription from Bright Data
2. Waiting for dataset provisioning (hours to days)
3. A separate dataset ID scoped to this account

This is a multi-day blocker with uncertain timeline. The Web Unlocker alternative is available today.

---

## 4. Proposed Architecture

### 4.1 Design Principle

Replace one function. Touch nothing else.

The existing architecture is sound. The scoring engine, ranking engine, outreach writer, and campaign orchestrator all operate on a `ProfileSchema` dict:

```python
{
    "login": str,
    "name": str | None,
    "bio": str | None,
    "location": str | None,
    "followers": int,
    "public_repos": int,
    "avatar_url": str,
    "html_url": str,
    "top_languages": list[str],
    "notable_repos": list[dict],
}
```

Both `fetch_github_profile()` (GitHub REST path) and `fetch_profiles_dataset()` (Bright Data Dataset path) produce this shape. The new `fetch_profiles_web_unlocker()` must produce the same shape. If it does, zero changes are required downstream.

### 4.2 New Pipeline

```
JD Analysis (jd_parsed in jobs.jd_parsed)
        │
        ▼
Featherless AI: extract_github_signals()
  → search_queries: ["language:python fastapi stars:>50", ...]
        │
        ▼ (for each query, parallel)
Bright Data SERP: search_candidates_serp()
  → github.com/{username} URLs → login strings
  [UNCHANGED — already working]
        │
        ▼
Deduplicate logins (dict keyed by login — already implemented)
        │
        ▼  ← V3 CHANGE: replace Dataset call here
Bright Data Web Unlocker: fetch_profiles_web_unlocker()
  → POST /request {zone: unlocker_zone, url: api.github.com/users/{login}, format: json}
  → Parse GitHub API JSON → ProfileSchema dict
        │
        ▼ (semaphore 3, parallel)
Featherless AI: score_and_write_outreach()
  → profile_score, matched_signals, gap_signals, outreach_email
  [UNCHANGED — already working]
        │
        ▼
Persist OutboundCandidate rows
  [UNCHANGED — already working]
```

### 4.3 Why Web Unlocker + GitHub REST API

| Factor | Dataset API | Web Unlocker + GitHub API |
|--------|-------------|--------------------------|
| Account status | ❌ Dataset not found | ✅ Zone available |
| Response format | Custom Bright Data schema | Standard GitHub REST JSON |
| Parsing complexity | Custom field mapping | Direct field mapping |
| Rate limits | Dataset queue-based | Per-request, real-time |
| Cost per profile | ~$0.003 (estimated) | ~$0.001–0.003/request |
| Latency | Async poll (30–120s wait) | Synchronous (~1–3s) |
| Setup required | New dataset subscription | Add zone name to .env |
| Existing code reuse | Partial | Full (same schema as GitHub REST) |

GitHub's REST API (`api.github.com`) returns well-structured JSON requiring no HTML parsing. Routing through Bright Data Web Unlocker provides residential IP rotation, bypassing GitHub's per-IP rate limits without requiring a GitHub API token (though a token can be forwarded as a header for authenticated 5000 req/hr limit instead of anonymous 60 req/hr).

---

## 5. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Campaign Trigger (HR Portal)              │
│              POST /campaigns/{jobId}/launch                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ FastAPI BackgroundTask
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  run_outbound_campaign()                     │
│                   [github_service.py]                        │
│                                                             │
│  1. Load campaign, job, jd_parsed from DB                   │
│  2. Resolve API keys from provider_manager + settings       │
│  3. Pre-flight checks (Featherless key, BD key or GH token) │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼ Step 1
┌─────────────────────────────────────────────────────────────┐
│              extract_github_signals()                        │
│                 [github_service.py]                          │
│                                                             │
│  Input:  jd_parsed dict                                     │
│  AI:     Featherless LLaMA 3.1 8B                           │
│  Output: {search_queries: ["lang:python fastapi ...", ...]} │
│  Tokens: ~400 in / ~200 out                                 │
│  Latency: ~2–4s                                             │
│  Logs: system_logs (event=outbound_signals)                 │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼ Step 2 (for each query, sequential)
┌─────────────────────────────────────────────────────────────┐
│              search_candidates_serp()                        │
│               [bright_data_service.py]                       │
│                                                             │
│  Input:  "site:github.com language:python fastapi ..."      │
│  API:    Bright Data SERP zone (/request endpoint)          │
│  Output: [{login, html_url}] — profile URLs only            │
│  Dedup:  dict keyed by login (already implemented)          │
│  Target: 5–15 unique logins per campaign                    │
│  Latency: ~3–8s per query                                   │
│  Logs: system_logs (event=github_search)                    │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼ Step 3 (NEW — replaces fetch_profiles_dataset)
┌─────────────────────────────────────────────────────────────┐
│           fetch_profiles_web_unlocker()  ← NEW FUNCTION      │
│               [bright_data_service.py]                       │
│                                                             │
│  Input:  logins: list[str]                                  │
│  API:    Bright Data Web Unlocker zone                      │
│  Target: api.github.com/users/{login} (JSON, no HTML parse) │
│  Also:   api.github.com/users/{login}/repos?sort=stars&n=5  │
│  Output: list[ProfileSchema] — identical to existing shape  │
│  Concurrency: asyncio.Semaphore(5) per profile              │
│  Retry: 2 attempts per profile, 2s backoff                  │
│  Fallback: on BD failure → fetch_github_profile() (GH REST) │
│  Latency: ~1–3s per profile, parallel                       │
│  Logs: system_logs (event=github_profile_fetch, api=brightdata)|
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼ Step 4 (for each profile, Semaphore(3))
┌─────────────────────────────────────────────────────────────┐
│              score_and_write_outreach()                      │
│                [outreach_writer.py]                          │
│                                                             │
│  Input:  ProfileSchema, jd_parsed, weights, hr_name         │
│  AI:     Featherless LLaMA 3.1 8B                           │
│  Output: {profile_score, matched_signals, outreach_email}   │
│  Tokens: ~600 in / ~500 out per candidate                   │
│  Latency: ~3–6s per candidate                               │
│  Logs: system_logs (event=outbound_profile_score)           │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼ Step 5
┌─────────────────────────────────────────────────────────────┐
│              Persist OutboundCandidate rows                  │
│                    [SQLite / SQLAlchemy]                     │
│                                                             │
│  campaign.total_found = saved_count                         │
│  campaign.status = "complete"                               │
│  campaign.completed_at = now()                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Bright Data Strategy

### 6.1 Products Used in V3

| Product | Stage | Zone Variable | Purpose |
|---------|-------|---------------|---------|
| SERP API | Candidate Discovery | `BRIGHTDATA_SERP_ZONE` | Google search → GitHub profile URLs |
| Web Unlocker | Profile Enrichment | `BRIGHTDATA_UNLOCKER_ZONE` | Proxy to GitHub REST API for profile data |

### 6.2 Web Unlocker Request Design

**Endpoint:** `POST https://api.brightdata.com/request`

**Request body (per profile):**
```json
{
    "zone": "web_unlocker",
    "url": "https://api.github.com/users/{login}",
    "format": "json",
    "headers": {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "OpenResource-Hiring-Platform"
    }
}
```

**Repos request (optional, for language enrichment):**
```json
{
    "zone": "web_unlocker",
    "url": "https://api.github.com/users/{login}/repos?sort=stars&per_page=5",
    "format": "json"
}
```

GitHub's REST API returns structured JSON and does not require anti-bot evasion. Web Unlocker adds IP rotation, which prevents the 60 req/hr anonymous rate limit from blocking the pipeline. The `Authorization: token {github_token}` header can optionally be forwarded if the Bright Data zone supports custom request headers, raising the limit to 5000 req/hr.

### 6.3 Profile Fetch Concurrency

```
logins = [l1, l2, l3, ..., l15]

asyncio.Semaphore(5) — 5 concurrent Web Unlocker requests

Each request:
  - Primary: Web Unlocker → api.github.com/users/{login}
  - Secondary: Web Unlocker → api.github.com/users/{login}/repos
  - Retry: 2 attempts with 2s backoff
  - Timeout: 15s per request
  - Fallback: direct GitHub REST via fetch_github_profile()
```

Two requests per profile (user + repos). With Semaphore(5), 15 profiles complete in ~4–8 parallel batches = ~20–40 seconds total for the enrichment stage.

### 6.4 Zone Configuration

New environment variable:
```
BRIGHTDATA_UNLOCKER_ZONE=web_unlocker
```

Add to `config.py` Settings:
```python
brightdata_unlocker_zone: str = ""
```

Add to provider manager `brightdata` config block:
```python
brightdata_cfg.get("unlocker_zone") or settings.brightdata_unlocker_zone
```

If `brightdata_unlocker_zone` is empty and `brightdata_api_key` is set, the pipeline falls back to `fetch_github_profile()` (direct GitHub REST). This maintains the current fallback behavior without requiring the unlocker zone to be configured for demo.

---

## 7. AI Strategy

### 7.1 Where Featherless AI Is Used

| Stage | Function | Model | Est. Tokens/Call | Calls/Campaign |
|-------|----------|-------|-----------------|----------------|
| Signal Extraction | `extract_github_signals()` | LLaMA 3.1 8B | 400 in / 200 out | 1 |
| Profile Scoring + Outreach | `score_and_write_outreach()` | LLaMA 3.1 8B | 600 in / 500 out | 1 per candidate |

### 7.2 Where Featherless AI Is NOT Used

- URL discovery (Bright Data SERP)
- Profile data fetching (Bright Data Web Unlocker → GitHub REST)
- Data persistence (SQLite)
- Campaign orchestration (Python asyncio)
- Response parsing (standard JSON parsing)

### 7.3 Token Budget Per Campaign (15 candidates)

| Stage | Input Tokens | Output Tokens |
|-------|-------------|---------------|
| Signal extraction | 400 | 200 |
| Profile scoring × 15 | 9,000 | 7,500 |
| **Total per campaign** | **~9,400** | **~7,700** |

At Featherless AI rates, a 15-candidate campaign uses approximately 17,100 tokens total. This is negligible relative to Featherless limits.

### 7.4 Latency Budget Per Campaign

| Stage | Duration | Parallelism |
|-------|----------|-------------|
| Signal extraction | 2–4s | Sequential |
| SERP search (3 queries) | 9–24s | Sequential |
| Profile enrichment (15 profiles) | 20–40s | Semaphore(5) |
| AI scoring (15 candidates) | 15–30s | Semaphore(3) |
| **Total wall clock** | **~50–100s** | — |

---

## 8. Cost Analysis

### 8.1 Per-Request Cost Estimates

| Product | Unit | Estimated Cost |
|---------|------|---------------|
| Bright Data SERP | per search | $0.004–0.010 |
| Bright Data Web Unlocker | per URL request | $0.001–0.003 |

_Note: Exact costs depend on zone pricing. Check the Bright Data console for your account's specific rates._

### 8.2 Per Campaign Cost

| Stage | Requests | Cost |
|-------|----------|------|
| SERP search (3 queries) | 3 | $0.012–0.030 |
| Profile fetch (15 profiles × 2 requests) | 30 | $0.030–0.090 |
| **Total per campaign** | **33** | **$0.042–0.120** |

### 8.3 Credit Projections

| Budget | Campaigns (conservative) | Campaigns (optimistic) |
|--------|--------------------------|------------------------|
| $249 | 2,075 campaigns | 5,928 campaigns |
| $50 | 416 campaigns | 1,190 campaigns |
| $10 | 83 campaigns | 238 campaigns |

**Demo viability:** At $249 available, the platform can run thousands of campaigns before credit exhaustion. The budget is not a constraint for the hackathon demo.

### 8.4 Cost Comparison: Dataset vs. Web Unlocker

The dataset subscription model would likely cost more per profile at volume ($0.003–0.010/profile depending on the dataset tier), with additional fixed monthly costs and a provisioning delay. Web Unlocker is pay-per-request with no setup cost.

---

## 9. Reliability Design

### 9.1 Retry Strategy

**Profile Enrichment (new stage):**
```
Attempt 1: Bright Data Web Unlocker → api.github.com
  → Success: use profile
  → Failure (timeout/5xx): wait 2s
Attempt 2: Bright Data Web Unlocker → api.github.com
  → Success: use profile
  → Failure: fall back to GitHub REST (fetch_github_profile)
Attempt 3: GitHub REST directly
  → Success: use profile
  → Failure: skip profile (log, do not fail campaign)
```

Skipping individual profiles is acceptable. A campaign with 12/15 candidates is more useful than a failed campaign with 0.

**SERP stage (existing):**
- Already retried implicitly by running multiple queries
- Per-query error is logged and loop continues

**AI scoring (existing):**
- `score_and_write_outreach()` already retries once on JSON decode failure
- Profile scoring failure skips the candidate (existing behavior)

### 9.2 Deduplication

**Within a campaign:**
- Logins deduplicated by `dict` keying in `run_outbound_campaign()` — already implemented
- Cross-campaign deduplication: not implemented. Acceptable for demo; add `github_profile_cache` in Phase 3 if needed

**SERP filter (already implemented):**
```python
# bright_data_service.py:144
if login.lower() in {"features", "topics", "explore", "marketplace", "about", "pricing", "orgs"}:
    continue
```

### 9.3 Rate Limiting

| Service | Limit | Current Handling |
|---------|-------|-----------------|
| Bright Data Web Unlocker | Account-level quota | Semaphore(5) prevents burst |
| Bright Data SERP | Account-level quota | Sequential queries |
| GitHub REST (fallback) | 60/hr anon, 5000/hr authed | Not rate-limited on Web Unlocker path |
| Featherless AI | Unknown, assumed generous | Semaphore(3) on scoring |

### 9.4 Campaign Crash Recovery

**Current behavior:** If the background task crashes mid-run, `campaign.status` stays `"running"` forever.

**V3 behavior (no change required for MVP):** The existing `except Exception` block at `github_service.py:528` sets `campaign.status = "error"` on any unhandled exception. This is sufficient for the demo.

**Future improvement (Phase 3):** Add a `completed_candidates` checkpoint field to `outbound_campaigns` so a restarted campaign can resume from the scoring stage rather than re-fetching all profiles.

### 9.5 Visibility of Failures

**Critical fix required alongside V3:** The current pipeline masks profile fetch failures as `"complete"` with 0 candidates. Add this guard:

```python
# After fetch_profiles_web_unlocker() returns empty
if not profiles:
    campaign.status = "error"
    campaign.error_message = "Profile enrichment returned no results"
    campaign.completed_at = now()
    db.commit()
    return
```

This prevents the silent-zero failure mode.

---

## 10. Failure Handling

### 10.1 Failure Decision Tree

```
SERP fails (400/407/timeout)
  ├─ Log: event=github_search, status=error
  ├─ Break query loop (existing behavior)
  └─ If all_users is empty → campaign.status = "error"
                             error_message = "SERP search failed: {exc}"
                             Return immediately

Profile enrichment returns empty (new guard)
  ├─ Log: event=github_profile_fetch, status=error
  └─ campaign.status = "error"
     error_message = "No profiles could be fetched from discovered URLs"
     Return immediately

Individual profile fetch fails (per-profile)
  ├─ Retry twice (Web Unlocker)
  ├─ Fallback to GitHub REST
  ├─ If still fails: log + skip candidate (do not fail campaign)
  └─ Campaign continues with remaining profiles

AI scoring fails for a candidate
  ├─ Log: event=outbound_profile_score, status=error
  └─ Skip candidate (existing behavior — return None from _score_profile)

Featherless AI fails entirely (signal extraction)
  ├─ Log: event=outbound_signals, status=error
  └─ campaign.status = "error" (existing behavior)
```

### 10.2 Error Surfacing

Every failure mode must write to `system_logs` with `campaign_id`. The Dev Portal log viewer queries `system_logs` filtered by `campaign_id` — this is already wired. Errors are visible to admins within seconds of occurrence.

The HR Portal should surface `campaign.status = "error"` with a human-readable message. The `OutboundCampaign` model currently has no `error_message` field — this is a data model gap (see Section 11).

---

## 11. Database Design

### 11.1 Required Schema Change: OutboundCampaign.error_message

The current `outbound_campaigns` table has no field to store a failure reason. When `status = "error"`, the HR portal shows "Error" with no explanation.

**Add column:**
```sql
ALTER TABLE outbound_campaigns ADD COLUMN error_message TEXT;
```

**SQLAlchemy model addition:**
```python
error_message = Column(Text, nullable=True)
```

This is the only schema change required for V3. All other existing columns are used correctly.

### 11.2 Optional: GitHub Profile Cache (Phase 3)

Cross-campaign profile caching eliminates redundant Bright Data requests for the same GitHub user. Not required for MVP.

```sql
CREATE TABLE github_profile_cache (
    username     TEXT PRIMARY KEY,
    profile_json TEXT NOT NULL,           -- JSON-encoded ProfileSchema dict
    source       TEXT NOT NULL,           -- "web_unlocker" | "github_rest"
    fetched_at   DATETIME NOT NULL,
    INDEX idx_fetched_at (fetched_at)
);
```

**Eviction policy:** Profiles older than 7 days are considered stale and re-fetched.

**Usage:** Before calling Web Unlocker, check cache. After successful fetch, write cache. This reduces cost by ~60–80% on repeated campaigns for the same role.

### 11.3 No Other Schema Changes

The existing `outbound_candidates` table already has all required fields:
- `github_username`, `github_url`, `name`, `bio`, `location` — mapped from ProfileSchema
- `top_languages`, `notable_repos` — mapped from ProfileSchema
- `followers`, `public_repos` — mapped from ProfileSchema
- `profile_score`, `matched_signals`, `gap_signals` — from AI scoring
- `outreach_email`, `outreach_status` — from outreach writer

The adapter layer is a pure mapping — no new columns needed.

---

## 12. Rollout Plan

### Phase 1 — Unblock the Pipeline (Target: same day, ~2–4 hours)

**Goal:** End-to-end campaigns produce candidates. The demo works.

**Changes:**
1. Add `fetch_profiles_web_unlocker()` to `bright_data_service.py`
   - POST to `/request` with Web Unlocker zone
   - Target `api.github.com/users/{login}` + `api.github.com/users/{login}/repos`
   - Map to existing ProfileSchema dict
   - Return `[]` on failure (preserves existing interface contract)
   
2. Wire into `run_outbound_campaign()` in `github_service.py`
   - Replace `fetch_profiles_dataset()` call with `fetch_profiles_web_unlocker()`
   - Pass `brightdata_unlocker_zone` resolved from provider_manager / settings
   
3. Add `brightdata_unlocker_zone` to `config.py` Settings

4. Add `error_message` column to `outbound_campaigns` (schema migration)

5. Add the `if not profiles → campaign.status = "error"` guard (eliminates silent-zero failure)

**Deliverable:** Running a campaign with a valid Bright Data API key and unlocker zone produces 10–30 scored candidates.

**Rollback:** If Web Unlocker calls fail, the pipeline falls back to `fetch_github_profile()` (GitHub REST). Zero regressions.

---

### Phase 2 — Fallback Hardening (Target: next day, ~2 hours)

**Goal:** Campaign works even when the Web Unlocker zone is not configured.

**Changes:**
1. In `fetch_profiles_web_unlocker()`, implement the three-tier fallback:
   - Tier 1: Web Unlocker → GitHub API
   - Tier 2: GitHub REST direct (existing `fetch_github_profile()`)
   - Tier 3: Skip profile (log, continue)
   
2. Per-profile retry with exponential backoff (2 attempts, 2s wait)

3. Semaphore tuning: Semaphore(5) for Web Unlocker, Semaphore(10) for GitHub REST fallback

**Deliverable:** Campaigns complete successfully even if `BRIGHTDATA_UNLOCKER_ZONE` is not set.

---

### Phase 3 — Observability and Caching (Target: Day 3, ~4 hours)

**Goal:** Reduce cost, improve demo repeatability, add campaign visibility.

**Changes:**
1. Implement `github_profile_cache` table
2. Cache reads before Web Unlocker calls; cache writes after successful fetches
3. 7-day TTL eviction
4. Add `campaign.error_message` to HR portal campaign card UI
5. Add campaign progress indicator (current step: signals / search / enrichment / scoring)

**Deliverable:** Second run of the same campaign costs 0 Bright Data credits for profile enrichment. HR sees descriptive error messages on failure.

---

### Phase 4 — Demo Polish (Target: Day 4, ~2 hours)

**Goal:** Demo-ready reliability.

**Changes:**
1. Validate `brightdata_unlocker_zone` at campaign creation time (not after background task starts)
2. Add campaign retry endpoint: `POST /campaigns/{id}/retry` resets status to `"running"` and re-queues the background task
3. Provider status endpoint: `GET /providers/status` returns health check for each configured provider including SERP and unlocker zones
4. Smoke test: `POST /campaigns/test` runs a 3-candidate mini-campaign to validate configuration

**Deliverable:** HR can recover from failed campaigns without dev intervention. Configuration problems surface before the campaign starts, not after.

---

## 13. Risk Register

### Risk 1 — Bright Data Web Unlocker Zone Not Configured
**Severity:** High  
**Probability:** Medium (requires one `.env` variable to be set)  
**Impact:** Web Unlocker path unavailable; falls back to GitHub REST  
**Mitigation:** Phase 2 fallback chain ensures campaigns still complete via GitHub REST. Add pre-flight zone validation in Phase 4.

### Risk 2 — GitHub API Returns 403 via Web Unlocker
**Severity:** High  
**Probability:** Low (GitHub API is accessible via residential IPs)  
**Impact:** Profile enrichment fails for affected usernames  
**Mitigation:** Per-profile retry; fallback to direct GitHub REST API. A GitHub token (even unauthenticated requests to public profiles rarely 403).

### Risk 3 — SERP Returns Non-Profile GitHub URLs
**Severity:** Medium  
**Probability:** Low (regex filter already implemented)  
**Impact:** Bad usernames passed to profile enrichment; they return 404  
**Mitigation:** Already handled: 404 on GitHub API → skip profile. The regex at `bright_data_service.py:139` filters non-profile URLs.

### Risk 4 — Featherless AI Malformed JSON in Scoring
**Severity:** Medium  
**Probability:** Low (retry logic already implemented)  
**Impact:** Individual candidate scoring failure; candidate is skipped  
**Mitigation:** `score_and_write_outreach()` already retries once. Skipped candidates do not fail the campaign.

### Risk 5 — Web Unlocker Zone Rate Limit / Quota
**Severity:** Medium  
**Probability:** Very low at demo scale  
**Impact:** Some profile requests fail mid-campaign  
**Mitigation:** Semaphore(5) prevents burst. Failed requests retry. Campaign completes with partial candidates (better than zero). At $249 credit, quota exhaustion requires running hundreds of concurrent campaigns.

### Risk 6 — SQLite WAL Corruption from Concurrent Background Tasks
**Severity:** Medium  
**Probability:** Low  
**Impact:** Campaign data loss  
**Mitigation:** Each campaign opens its own DB session (`SessionLocal()`) and closes it in `finally`. This is already implemented. SQLite WAL mode handles concurrent readers. Do not run multiple campaigns simultaneously in production.

### Risk 7 — GitHub Profile Data Too Sparse for Scoring
**Severity:** Low  
**Probability:** Medium (some developers have minimal profiles)  
**Impact:** Low-quality outreach emails; irrelevant score  
**Mitigation:** AI scorer already handles sparse input gracefully (outputs low score). SERP results tend toward more visible developers. Sparse profiles score low, rank low, and are de-prioritized naturally.

### Risk 8 — Bright Data Credits Exhausted Before Demo
**Severity:** Low  
**Probability:** Very low  
**Impact:** Outbound sourcing fails  
**Mitigation:** At $0.12/campaign maximum, $249 covers 2,000+ campaigns. The demo risk budget is effectively unlimited.

---

## 14. Recommendation

**Implement Phase 1 immediately.**

The architectural change is minimal: one new function in `bright_data_service.py`, one new call in `github_service.py`, two new `.env` variables, one new column. Estimated implementation time: 2–4 hours.

The existing architecture does not need to be redesigned. The scoring engine, ranking engine, and outreach writer are correct and reusable without modification. The adapter layer between Web Unlocker output and the existing scoring engine is a direct schema mapping that requires no abstraction.

**The fallback chain (Web Unlocker → GitHub REST → skip) means that even if the Web Unlocker zone is misconfigured, the pipeline works.** The demo is protected by the existing GitHub REST fallback that already exists in the codebase.

**Do not attempt to fix the Dataset ID.** Obtaining a valid Bright Data Dataset ID requires account provisioning that is outside the engineering team's control and has an uncertain timeline. The Web Unlocker path is entirely within the team's control and requires only an `.env` change plus 150 lines of code.

---

## Appendix A — Function Signature for fetch_profiles_web_unlocker

```python
async def fetch_profiles_web_unlocker(
    usernames: list[str],
    api_key: str,
    unlocker_zone: str,
    github_token: str = "",
) -> list[dict]:
    """
    Fetch enriched GitHub profiles via Bright Data Web Unlocker proxying
    the GitHub REST API. Drops in as a replacement for fetch_profiles_dataset().

    Returns list[dict] in the same ProfileSchema shape:
        {login, name, bio, location, followers, public_repos,
         avatar_url, html_url, top_languages, notable_repos}

    Failures for individual profiles are logged and skipped.
    Returns [] only if all profiles fail.
    Falls back to fetch_github_profile() (GitHub REST) if Web Unlocker fails.
    """
```

## Appendix B — New Environment Variables

```env
# Add to .env alongside existing BRIGHTDATA_API_KEY and BRIGHTDATA_SERP_ZONE
BRIGHTDATA_UNLOCKER_ZONE=web_unlocker   # Your Web Unlocker zone name in Bright Data console
```

## Appendix C — Schema Migration

```sql
-- Run once against hireai.db, or delete hireai.db to trigger auto-recreate
ALTER TABLE outbound_campaigns ADD COLUMN error_message TEXT;
```

Or, for demo: delete `hireai.db` and restart the backend — SQLAlchemy recreates all tables from models on startup.
