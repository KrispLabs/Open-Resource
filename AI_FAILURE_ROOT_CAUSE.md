# AI Failure Root Cause Analysis

## TL;DR

Every AI call was failing before the HTTP request even left the process.

```
ERROR: Illegal header value b'Bearer '
```

The Featherless API key resolved to an empty string in every service, so the
`Authorization` header became `Bearer ` (value = single space). httpx validates
headers before sending and raises `IllegalHeaderValue` — no network call was
ever attempted.

---

## Primary Root Causes

### CAUSE-1: API key lost on DB reset (Critical)

When the lifecycle migration required deleting `hireai.db`, any API keys that
had previously been configured via the web UI (stored only as encrypted blobs in
`provider_configs`) were permanently lost. The `.env` file only contained
BRIGHTDATA credentials; FEATHERLESSAI_API_KEY and GITHUB_TOKEN were blank.

Evidence:
```
FEATHERLESSAI_API_KEY: len=0 empty=True
GITHUB_TOKEN:          len=0 empty=True
BRIGHTDATA_API_KEY:    len=36 empty=False   ← was in .env, survived
```

### CAUSE-2: migrate_env_to_db skipped re-migration on incomplete configs (Critical)

`migrate_env_to_db()` called `is_configured(pid)` which returned `True` for any
provider with a DB row and `status="configured"` — even if the stored config had
no `api_key`. This meant:

1. First restart after DB delete: migration ran with empty `FEATHERLESSAI_API_KEY`.
   Stored `{"model": "meta-llama/..."}` — no `api_key`. Row marked `configured`.
2. Second restart: `is_configured()` returned `True` → migration skipped.
3. User could add the key to `.env` and restart — migration would still skip it
   because the row "looked" configured.

### CAUSE-3: health endpoint reported false "configured" (Misleading)

`GET /health` returned `"claude": "configured"` even when `api_key` was empty.
The check was:
```python
provider_manager.is_configured("featherless")  # True if row exists — NOT if key is valid
```
This masked the problem from any monitoring.

### CAUSE-4: Silent exception swallowing in bright_data_service.py (Bug)

```python
except (httpx.HTTPStatusError, ValueError, _json.JSONDecodeError):
    return []
```
Any HTTP error from Bright Data (including 401 auth failures) returned `[]`
silently. The campaign would then complete with 0 candidates and status="complete"
instead of "error" — hiding credential problems completely.

### CAUSE-5: All AI service logs reported api_provider="claude" (Misleading)

`jd_analyzer.py`, `scorer.py`, and `github_service.py` all logged
`api_provider="claude"` for Featherless AI calls. This made the system logs show
"claude" failing when the actual provider is "featherless", confusing debugging.

### CAUSE-6: No pre-flight validation before campaign creation (Missing guard)

`POST /api/jobs/{id}/campaigns` accepted the request, created a DB row with
`status="running"`, then launched a background task that immediately failed with
a cryptic `Illegal header value` error. The frontend would show a running
campaign, poll for 3s, then see `status="error"` with no user-visible explanation.

### CAUSE-7: Services ignored model configured in provider_manager (Minor)

All services hardcoded `"meta-llama/Meta-Llama-3.1-8B-Instruct"` instead of
reading `provider_manager.get("featherless").get("model")`. Changing the model
via the provider config UI had no effect.

---

## Why AI Features "Felt Fake"

The entire AI pipeline was never executing. Here is what each feature was
actually doing:

| Feature | Observed | Actual cause |
|---------|----------|-------------|
| JD Analysis | 502 error after 500ms | httpx rejected illegal header, raised before any network call |
| Candidate Scoring | SSE stream complete, scores = 0 | score_candidate raised ValueError, SSE emitted "error" events with score=0 |
| Outbound Campaign | Running → Error in <1s | Background task hit pre-flight key check (after fix), or hit `Illegal header` in extract_github_signals |
| Campaign outreach | Never generated | Never reached outreach stage |

---

## Evidence from system_logs

```
[19:07:09] outbound_signals  featherless  error  0ms  ERR: Illegal header value b'Bearer '
[19:06:24] outbound_signals  featherless  error  0ms  ERR: Illegal header value b'Bearer '
[18:59:33] jd_analysis       featherless  error  513ms ERR: Illegal header value b'Bearer '
```

Latency of 0ms on outbound_signals = failed before any HTTP was sent.
Latency of 513ms on jd_analysis = httpx connection setup time before header validation.
