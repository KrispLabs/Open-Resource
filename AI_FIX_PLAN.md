# AI Fix Plan

## Immediate User Action Required

```
FEATHERLESSAI_API_KEY is empty in apps/backend/.env
GITHUB_TOKEN is empty in apps/backend/.env
```

Add your Featherless API key:
```env
FEATHERLESSAI_API_KEY=your_key_here
```

Then restart the backend:
```bash
pkill -f "uvicorn main:app"
cd apps/backend && .venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

The improved `migrate_env_to_db()` will detect the missing field and re-migrate.
The startup log should then show:
```
INFO: Provider 'featherless' has missing required fields ['api_key'] — re-migrating from env.
```

## Code Fixes Applied (This Session)

### 1. migrate_env_to_db — Re-migration on incomplete configs [FIXED]
**File**: `services/provider_manager.py`
**Before**: Skipped migration if ANY row with `status="configured"` existed.
**After**: Checks required secret fields; re-migrates if env now supplies what's missing.

### 2. check_required_providers — Startup warning [NEW]
**File**: `services/provider_manager.py`
**After**: Logs ERROR-level warning at startup for any required provider with missing fields.
```
ERROR: REQUIRED provider 'Featherless AI' is missing field(s) ['api_key'].
       AI features WILL FAIL until you set ['FEATHERLESSAI_API_KEY'] in your .env and restart.
```

### 3. health endpoint — Truthful status reporting [FIXED]
**File**: `main.py`
**Before**: `"claude": "configured"` even when api_key was empty.
**After**: `"featherless": "missing_api_key"` or `"ready"` based on actual key presence.

### 4. Campaign creation pre-flight [NEW]
**File**: `routers/outbound.py`
**After**: `POST /api/jobs/{id}/campaigns` returns 503 immediately if:
- Featherless api_key is empty
- No GitHub sourcing provider (both GITHUB_TOKEN and BRIGHTDATA_API_KEY empty)
- `POST /api/jobs/{id}/campaigns` also now returns 400 if job.jd_parsed is None
  (job was never analyzed — campaign would produce empty search_queries and complete
  with 0 candidates silently)

### 5. Featherless key pre-flight in services [NEW]
**Files**: `services/jd_analyzer.py`, `services/scorer.py`, `services/github_service.py`
**After**: Each raises `ValueError("Featherless API key not configured...")` immediately
instead of building an illegal header. Error surfaces in system_logs with clear message.

### 6. Model reads from provider_manager [FIXED]
**Files**: `services/jd_analyzer.py`, `services/scorer.py`
**Before**: `"model": "meta-llama/Meta-Llama-3.1-8B-Instruct"` hardcoded.
**After**: `model = featherless_cfg.get("model") or "meta-llama/..."` — respects
the model configured in the provider UI.

### 7. bright_data_service — No more silent HTTP error swallowing [FIXED]
**File**: `services/bright_data_service.py`
**Before**: `except (httpx.HTTPStatusError, ValueError, ...): return []`
**After**: Propagates `ValueError` and `httpx.HTTPStatusError` so campaign sets
`status="error"` and logs the failure. Only `JSONDecodeError` returns empty.

### 8. Wrong api_provider labels in logs [FIXED]
**Files**: `jd_analyzer.py`, `scorer.py`, `github_service.py`
**Before**: All Featherless calls logged `api_provider="claude"`.
**After**: `api_provider="featherless"` — system_logs are now accurate.

### 9. Bright Data re-migrated [APPLIED]
The brightdata provider_config row was rebuilt from env at runtime.
All three fields now present: `api_key` (len=36), `serp_zone`, `dataset_id`.
SERP API confirmed live with real response.

## Remaining Risks

### R1: DB reset destroys credentials (Architectural)
Credentials are stored encrypted in SQLite. If `hireai.db` is deleted, all
provider API keys are lost unless they're also in `.env`.
**Mitigation**: Always keep `.env` populated. Do not delete the DB without
backing up the provider_config table.
**Long-term**: Use Alembic migrations instead of DB deletes for schema changes.

### R2: Bright Data dataset snapshot timeout (Operational)
`PROFILE_TIMEOUT = 120.0s` — if Bright Data dataset takes >2 min, the campaign
goes to error. This is expected in degraded conditions but could confuse users.
**Mitigation**: Consider raising timeout to 180s; add partial-result handling.

### R3: Featherless JSON malformed response (Operational)
`score_and_write_outreach` retries once on `JSONDecodeError`. If both attempts
return malformed JSON, the candidate is skipped silently. The log shows status="error"
per candidate but the campaign continues.
**Mitigation**: Acceptable. Candidate count in campaign shows fewer than expected.

### R4: SSE keepalive with long Featherless latency (Known)
If a candidate takes >75s (3 keepalive intervals × 25s), the HR portal shows
"Still processing..." which is correct but could mislead users.
**Mitigation**: No change needed — this is the designed behavior.

## Validation Checklist (run after adding FEATHERLESSAI_API_KEY)

```bash
# 1. Health check
curl http://127.0.0.1:8000/health
# Expected: {"featherless": "ready", "github_sourcing": "ready"}

# 2. JD Analysis
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"hr@openresource.com","password":"demo1234"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
JOB_ID=<your_job_id>
curl -s -X POST http://127.0.0.1:8000/jobs/$JOB_ID/analyze \
  -H "Authorization: Bearer $TOKEN" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print('jd_parsed:', bool(d.get('jd_parsed')))"

# 3. Check system_logs — should show SUCCESS
# Expected: event_type=jd_analysis api_provider=featherless status=success tokens=NNN

# 4. Outbound campaign — should no longer return 503
curl -s -X POST http://127.0.0.1:8000/api/jobs/$JOB_ID/campaigns \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
# Expected: {"campaign_id": "...", "status": "running"}

# 5. Monitor campaign logs
# system_logs should show:
#   outbound_signals / featherless / SUCCESS
#   github_search / brightdata / SUCCESS
#   outbound_profile_score / featherless / SUCCESS
```
