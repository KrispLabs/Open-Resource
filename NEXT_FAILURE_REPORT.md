# NEXT_FAILURE_REPORT — Outbound Pipeline Step 3

Generated: 2026-05-29  
Campaign under test: `a10ff02d-3ae9-4e34-9cae-11f311b365b8`

---

## Fix Applied (Step 2 — now confirmed working)

**File**: `apps/backend/services/github_service.py`  
**Function**: `extract_github_signals`  
**Change**: replaced single `json.loads(content)` call with the same two-stage parsing
strategy used by `jd_analyzer._extract_json()`: strip code fences → direct parse →
brace-extraction fallback.

**Evidence from DB**:
- Campaign `a10ff02d` reached `github_search` event (Step 3) — it would have stopped at
  `outbound_signals` if Step 2 was still broken.
- `github_search_signals` column populated: `{"languages": ["python"], "keywords": ["fastapi"], "search_queries": ["language:python fastapi stars:>50"]}`
- Previous campaign `6422222a` stopped at `outbound_signals|featherless|error|Extra data: line 9 column 1 (char 147)`.

Step 2 is fixed. Step 3 is the new blocker.

---

## First Failing Step

**Step 3 — Bright Data SERP candidate search**

---

## Stack Trace (reconstructed from DB log)

```
system_logs entry:
  event_type   = github_search
  api_provider = brightdata
  status       = error
  latency_ms   = 0
  error_message = "Client error '400 Bad Request' for url 'https://api.brightdata.com/request'
                   For more information check: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400"

Call path:
  run_outbound_campaign()           github_service.py:285
    → search_candidates_serp()      bright_data_service.py:73
        POST https://api.brightdata.com/request  → HTTP 400
        resp.raise_for_status()     bright_data_service.py:97
        ← httpx.HTTPStatusError raised
      except (ValueError, httpx.HTTPStatusError): raise
    ← HTTPStatusError propagates to run_outbound_campaign
  except Exception as exc:          github_service.py:310–319
    write_log(..., status="error")  ← logged
    # no break — loop continues
  → all search_queries fail identically → all_users = {}
  if not all_users:                 github_service.py:351
    campaign.status = "complete"    ← silent degradation (NOT "error")
    total_found = 0
```

---

## Root Cause

Bright Data's `/request` endpoint returns **HTTP 400 Bad Request** when called with:
```json
{
  "zone": "serp_api2",
  "url": "https://www.google.com/search?q=site:github.com+language:python+fastapi+stars:>50",
  "format": "json"
}
```

**Most likely cause**: The zone name `"serp_api2"` does not exist in this Bright Data account,
or the account tier does not include Web Unlocker access for Google Search. Bright Data returns
HTTP 400 (not 407) when the zone name is invalid via the REST API.

**Secondary finding**: The actual Bright Data error message is never captured. `resp.raise_for_status()`
converts the response to an httpx exception that only includes the status code. `resp.text` (the
real error from Bright Data, e.g. `"zone 'serp_api2' not found"`) is lost.

**Tertiary finding — silent degradation**: `except Exception` in `run_outbound_campaign`
(line 310) does not `break` the query loop for non-`ValueError` exceptions. All queries fail
identically, `all_users` stays empty, and the campaign status is set to `"complete"` with
`total_found=0` instead of `"error"`. The user sees a completed campaign with zero candidates
and no indication of the API failure (unless they check system logs in the Dev portal).

---

## Confidence Level

**HIGH** — Confirmed by:
1. `system_logs` DB entry for campaign `a10ff02d` showing `github_search|brightdata|error|400 Bad Request`
2. Campaign `github_search_signals` populated (Step 2 worked, Step 3 is where it stopped)
3. Campaign status = `complete`, `total_found = 0` (silent degradation pattern)
4. Code review of `search_candidates_serp` showing that 400 is not explicitly handled (only 407 is)

---

## Files Involved

| File | Function | Line | Role |
|---|---|---|---|
| `apps/backend/services/bright_data_service.py` | `search_candidates_serp` | 88–109 | Makes the failing POST to `/request`; catches 407 but not 400 |
| `apps/backend/services/github_service.py` | `run_outbound_campaign` | 299–319 | Catches `Exception` but doesn't `break` → silent degradation |

---

## What Is NOT the Problem

- The Bright Data API key itself — it is configured (`brightdata|healthy` in `provider_configs`)
- The outbound_signals (Step 2) — now fixed; signals are extracted and stored
- The Featherless AI provider — working correctly
- Campaign creation / pre-flights — working correctly
