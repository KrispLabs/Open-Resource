# Outbound PAT Migration Plan

**Date:** 2026-05-29
**Branch:** `outbound-v3-rebuild`
**Safety snapshot (rollback point):** `1569be7` — *"Stable baseline before outbound v3 migration"* (working tree clean)
**Status:** ANALYSIS — awaiting approval before any code change
**Scope:** Surgical replacement of the broken profile-enrichment stage only.

---

## 0. The One-Line Change

> Replace the call to `fetch_profiles_dataset()` (Bright Data Dataset — 404) with a new
> `fetch_profiles_pat()` (GitHub REST via PAT) inside `run_outbound_campaign()`.
> Everything before it (SERP discovery) and after it (AI scoring, outreach, persistence)
> stays byte-for-byte identical.

The codebase **already contains** a working single-profile PAT fetcher — `fetch_github_profile()` —
used today in the non-Bright-Data fallback path. The migration generalizes that proven logic
into a batched, concurrent function and wires it into the SERP path. This is low-risk because
the enrichment-via-PAT code path is already exercised and trusted in production.

---

## 1. Current Data Flow

```
run_outbound_campaign(campaign_id)            [github_service.py:198]
  │
  ├─ Resolve keys (provider_manager → settings)
  │     featherless_api_key, github_token, brightdata_api_key, brightdata_serp_zone
  │     use_brightdata = bool(brightdata_api_key)
  │
  ├─ Pre-flight guards
  │     • Featherless key present            (else status=error)
  │     • use_brightdata OR github_token      (else status=error)   ← CHANGES
  │     • jd_parsed present                   (else status=error)
  │
  ├─ STEP 1  extract_github_signals(jd_parsed)          → search_queries[]      [Featherless]
  │
  ├─ STEP 2  discovery  (per query, dedup by login → all_users{})
  │     if use_brightdata:  search_candidates_serp()    → [{login,...}]         [Bright Data SERP]  ✅ KEEP
  │     else:               search_github_users()       → [{login,...}]         [GitHub REST]       ✅ KEEP
  │
  ├─ STEP 3  enrichment
  │     if use_brightdata:  fetch_profiles_dataset()    → profiles[]   ❌ BROKEN (404)   ← REPLACE
  │     else:               fetch_github_profile() ×N   → profiles[]   ✅ KEEP (PAT, proven)
  │
  ├─ STEP 4  score_and_write_outreach(profile, …) ×N    → scored[]              [Featherless]  ✅ KEEP
  │
  └─ STEP 5  persist OutboundCandidate rows + status/total_found                ✅ KEEP
```

**Only STEP 3's Bright-Data branch is broken. Nothing else is touched.**

---

## 2. Existing Profile Shape (the contract both producers honor)

Both `fetch_github_profile()` and `fetch_profiles_dataset()` emit the **same dict shape**.
Any replacement MUST emit this same shape:

```python
{
    "login":         str,          # GitHub username
    "name":          str | None,
    "bio":           str | None,
    "location":      str | None,
    "followers":     int,
    "public_repos":  int,
    "avatar_url":    str,
    "html_url":      str,          # → persisted as github_url
    "top_languages": list[str],    # e.g. ["Python", "Go"]  (max 5)
    "notable_repos": list[dict],   # [{name, stars, description, language}]  (max 5)
}
```

`fetch_github_profile()` reference: `github_service.py:184–195`.

---

## 3. Existing Scorer Inputs (what STEP 4 actually reads)

From `score_and_write_outreach()` → `OUTREACH_USER_TEMPLATE.format(...)` (`outreach_writer.py:54–67`):

| Field consumed by scorer | Source in profile dict | Notes |
|--------------------------|------------------------|-------|
| `login`                  | `profile["login"]`     | required |
| `name`                   | `profile["name"]`      | falls back to login |
| `bio`                    | `profile["bio"]`       | "N/A" if None |
| `location`               | `profile["location"]`  | "N/A" if None |
| `top_languages`          | `profile["top_languages"]` | required |
| `notable_repos`          | `profile["notable_repos"]` | required — email must cite a repo name |
| `followers`              | `profile["followers"]` | required |
| `public_repos`           | `profile["public_repos"]` | required |
| (from JD) `role_title`, `must_have_skills` | `jd_parsed` | unchanged |

**The scorer does NOT read** `avatar_url`, `html_url`, `total_stars`, or `recent_activity`.
Therefore extra fields are safe to add (ignored downstream) and missing extras break nothing.

---

## 4. Required Field → Endpoint → Consumer Map

GitHub endpoints needed (both authenticated with the PAT, 5000 req/hr):

| Field | Classification | Source Endpoint | Used By |
|-------|---------------|-----------------|---------|
| `login` | **Required** | `GET /users/{u}` | scorer, persist (`github_username`) |
| `name` | **Required** | `GET /users/{u}` | scorer, persist |
| `bio` | **Required** | `GET /users/{u}` | scorer, persist |
| `followers` | **Required** | `GET /users/{u}` | scorer, persist |
| `public_repos` | **Required** | `GET /users/{u}` | scorer, persist |
| `top_languages` | **Required** | `GET /users/{u}/repos` | scorer, persist |
| `notable_repos` | **Required** | `GET /users/{u}/repos` | scorer, persist |
| `recent_activity` | Required (spec) | `GET /users/{u}/repos` (`pushed_at`) | schema completeness (scorer ignores) |
| `location` | Optional | `GET /users/{u}` | scorer, persist |
| `total_stars` | Optional (spec) | `GET /users/{u}/repos` (Σ `stargazers_count`) | schema completeness (scorer ignores) |
| `avatar_url` | Optional | `GET /users/{u}` | persist parity |
| `html_url` | Optional | `GET /users/{u}` | persist (`github_url`) |
| `company` | Optional (not used) | `GET /users/{u}` | — (skip) |
| `blog`/website | Optional (not used) | `GET /users/{u}` | — (skip) |
| pinned repos | Optional (not used) | GraphQL only | — (skip; REST has no pinned endpoint) |

**Two REST calls per candidate.** No GraphQL, no scraping, no third-party. Pinned repos are
intentionally out of scope (REST cannot return them; `notable_repos` by stars is the substitute).

---

## 5. Target Profile Schema (emitted by `fetch_profiles_pat()`)

Superset of the existing contract (§2) + the two spec-requested extras. Backward compatible.

```json
{
  "login": "torvalds",
  "name": "Linus Torvalds",
  "bio": null,
  "location": "Portland, OR",
  "followers": 305000,
  "public_repos": 11,
  "avatar_url": "https://avatars.githubusercontent.com/u/1024025",
  "html_url": "https://github.com/torvalds",
  "top_languages": ["C", "Assembly", "Shell"],
  "notable_repos": [
    {"name": "linux", "stars": 235000, "description": "Linux kernel source tree", "language": "C"}
  ],
  "total_stars": 280000,
  "recent_activity": true
}
```

- `total_stars` = Σ `stargazers_count` across fetched repos.
- `recent_activity` = `True` if any repo `pushed_at` within the last 180 days (else `False`).
- `top_languages`, `notable_repos`: same derivation rule already used by `fetch_github_profile()`
  (unique non-null languages; top repos by stars; max 5 each).

---

## 6. Exact Files To Modify

| File | Change | Risk |
|------|--------|------|
| `services/github_service.py` | **(a)** Add new `fetch_profiles_pat()`. **(b)** In STEP 3, replace the `fetch_profiles_dataset()` call with `fetch_profiles_pat()`. **(c)** Update pre-flight: GitHub PAT is now required for enrichment. | Low — additive function + one branch swap + one guard |
| `services/bright_data_service.py` | **No functional change.** `fetch_profiles_dataset()` becomes dead code (no longer imported/called). Leave in place or annotate as deprecated. SERP function untouched. | None |
| `config.py` | **No change required** — `github_token` already exists (`config.py:17`). `brightdata_dataset_id` becomes vestigial; left as-is. | None |
| `routers/outbound.py` | **Optional** — tighten the create-campaign pre-flight (line 63) to require a PAT so campaigns are rejected early with HTTP 503 instead of erroring in the background task. Recommended but not strictly required. | Very low |

**Explicitly NOT touched:** `jd_analyzer.py`, `scorer.py`, `outreach_writer.py`, ranking logic,
scoring weights, AI prompts, Featherless integration, HR/applicant portal flows, DB schema,
`search_candidates_serp()`.

---

## 7. `fetch_profiles_pat()` Design

```python
async def fetch_profiles_pat(
    usernames: list[str],
    github_token: str,
    max_concurrency: int = 5,
    max_retries: int = 2,
) -> list[dict]:
    """
    Batch-enrich GitHub usernames into the existing ProfileSchema via the GitHub REST API.
    - async, Semaphore(max_concurrency)
    - per-username: GET /users/{u}  +  GET /users/{u}/repos?per_page=100&sort=pushed (concurrent)
    - retries (max_retries) on 5xx / timeout / secondary-rate-limit (403 + Retry-After), backoff
    - 404 (deleted/suspended account) → log + skip (returns None for that user)
    - 401 (invalid PAT) → raise immediately so the whole campaign errors visibly (not silent)
    - graceful degradation: one failed candidate never fails the batch
    Returns list[ProfileSchema] (Nones filtered out).
    """
```

**Failure semantics**

| Condition | Behavior |
|-----------|----------|
| One username 404 / network error | Logged, skipped; batch continues |
| Repos call fails but user call ok | Emit profile with empty `top_languages`/`notable_repos` |
| Invalid PAT (401) | Raise → caller sets `campaign.status="error"` with clear message |
| All usernames fail | Empty list → caller sets `campaign.status="error"` (no silent "complete with 0") |

**Caller change in `run_outbound_campaign()` STEP 3:**

```python
if use_brightdata:
    # was: fetch_profiles_dataset(list(all_users.keys()), brightdata_api_key, settings.brightdata_dataset_id)
    profiles = await fetch_profiles_pat(list(all_users.keys()), github_token)
    # one summary github_profile_fetch log (requested=N, returned=M) — same as before
else:
    # UNCHANGED — existing per-profile fetch_github_profile() path
```

**Pre-flight change** (`github_service.py` ~line 252): PAT is now mandatory because enrichment
always uses it. Replace `if not use_brightdata and not github_token:` with a guard that errors
whenever `github_token` is absent, with an actionable message.

---

## 8. Risk Assessment

| # | Risk | Severity | Likelihood | Mitigation |
|---|------|----------|------------|------------|
| R1 | **`GITHUB_TOKEN` is currently empty in `.env`** → every campaign errors at pre-flight until a PAT is set | **High** | **Certain** | Set a real PAT in `.env` (auto-migrates on restart via `migrate_env_to_db`) or configure via Dev portal. This is now a hard precondition — documented in validation. |
| R2 | Featherless key also empty in `.env` → STEP 1 & 4 fail regardless of this migration | High | Certain (current state) | Out of enrichment scope, but end-to-end demo requires it. Flagged in validation preconditions. |
| R3 | GitHub rate limit (5000/hr authed) | Low | Low | 2 calls/candidate; ~30 calls for 15 candidates. Semaphore(5) keeps it polite. |
| R4 | GitHub secondary rate limit (abuse detection, 403 + Retry-After) | Low | Low | Retry honoring `Retry-After`; skip on exhaustion. |
| R5 | Username from SERP no longer exists (404) | Low | Medium | Per-username skip; batch continues. |
| R6 | Schema drift — extra fields confuse persist | None | None | Persist reads named keys only (`scored.get(...)`); extras dropped harmlessly. `total_stars`/`recent_activity` have no DB column → not persisted (acceptable). |
| R7 | Existing fallback path regresses | None | None | Fallback branch (`else`) is left **untouched**. |
| R8 | `fetch_profiles_dataset()` dead code | Cosmetic | — | Left in place, no longer called. Optional later cleanup. |

**Net assessment:** The only operational blocker is **R1 — a PAT must be present.** The code change
itself is low-risk because it promotes already-proven PAT logic and leaves every other stage intact.

---

## 9. Rollback

```bash
git reset --hard 1569be7      # "Stable baseline before outbound v3 migration"
```
Single commit, clean tree at baseline → instantaneous rollback with zero residue.

---

## 10. Post-Implementation Validation (Step 7 preview → `OUTBOUND_PAT_VALIDATION.md`)

To be produced **after** implementation:

- ✓ SERP discovery still returns usernames (Bright Data key present — testable now)
- ✓ `fetch_profiles_pat()` returns correct schema for known users (testable unauthenticated at low volume, or authenticated once PAT set)
- ✓ `top_languages` / `notable_repos` populated from repos endpoint
- ✓ Scorer receives the expected 8 fields (schema assertion)
- ✓ Outreach generation unchanged (requires Featherless key)
- ✓ Candidates persist; `total_found` accurate
- ✓ Campaign reaches `complete` (or `error` with a clear message — never silent 0)

---

## Decision Required Before Coding

1. **Approve this plan to proceed to Step 6 (implementation)?**
2. **Confirm a `GITHUB_TOKEN` (PAT) will be provided** in `.env` (it is currently empty —
   without it, campaigns will correctly refuse to run after this change).
3. **Include the optional `routers/outbound.py` early pre-flight tightening?** (recommended)
