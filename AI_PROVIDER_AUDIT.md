# AI Provider Audit

## Provider Status (post-fix)

| Provider | Status | Key Present | Notes |
|----------|--------|-------------|-------|
| Featherless AI | missing_api_key | NO | FEATHERLESSAI_API_KEY blank in .env — requires user action |
| Bright Data | ready | YES (len=36) | SERP confirmed live — returns GitHub usernames |
| GitHub REST | missing | NO | GITHUB_TOKEN blank — fallback only, not needed if Bright Data is set |

## Live Bright Data Verification

```bash
# SERP query: "python fastapi developer"
Found 2 candidates:
  {'login': 'fastapi', 'html_url': 'https://github.com/fastapi'}
  {'login': 'tiangolo', 'html_url': 'https://github.com/tiangolo'}
```

Bright Data SERP API: **CONFIRMED WORKING**

## Featherless AI Verification

Cannot verify — API key is empty. After key is added:

```bash
curl -s -X POST https://api.featherless.ai/v1/chat/completions \
  -H "Authorization: Bearer $FEATHERLESSAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"meta-llama/Meta-Llama-3.1-8B-Instruct","messages":[{"role":"user","content":"ping"}],"max_tokens":1}'
```

The internal validator (`POST /api/providers/validate?provider_id=featherless`)
will confirm health once configured.

## Provider Configuration Architecture

All provider credentials are stored encrypted in `provider_configs` table using
AES-256-GCM with server_secret_key as master key. Services call:

```python
provider_manager.get("featherless").get("api_key")
```

Not `settings.featherlessai_api_key` directly (though a fallback exists).

**Critical**: Credentials stored in DB are lost on DB reset. The `.env` file
is the only durable backup of credentials outside the DB. Always populate `.env`
with all API keys before running; they are migrated to encrypted DB on first run.

## Provider Execution Paths

### JD Analysis (Featherless)
```
POST /jobs/{id}/analyze
→ jd_analyzer.analyze_jd()
→ httpx POST https://api.featherless.ai/v1/chat/completions
→ model: provider_manager.get("featherless").get("model")
→ max_tokens: 1024, temperature: 0.2
→ JSON parse → normalize weights → DB persist
→ system_logs: event_type=jd_analysis api_provider=featherless
```

### Candidate Scoring (Featherless)
```
GET /jobs/{id}/stream
→ SSE event_stream()
→ asyncio.Semaphore(5) parallel scorer.score_candidate()
→ PDF text extraction → httpx POST featherless
→ max_tokens: 1500, temperature: 0.1
→ CandidateScore DB row → rank assignment
→ system_logs: event_type=candidate_scoring api_provider=featherless
```

### Outbound Campaign (Bright Data + Featherless)
```
POST /api/jobs/{id}/campaigns  [pre-flight checks Featherless + GitHub sourcing]
→ background asyncio task: run_outbound_campaign()

Step 1 — Signal extraction (Featherless):
  extract_github_signals(jd_parsed, featherless_api_key)
  → httpx POST featherless → search_queries list

Step 2 — Developer search (Bright Data SERP):
  search_candidates_serp(query, brightdata_api_key, serp_zone)
  → httpx POST https://api.brightdata.com/request
  → zone: serp_api2, url: google.com/search?q=site:github.com+{query}
  → parse organic results → extract github.com/{login} URLs

Step 3 — Profile enrichment (Bright Data dataset OR GitHub REST):
  fetch_profiles_dataset(usernames, brightdata_api_key, dataset_id)
  → trigger+poll Bright Data dataset snapshot
  OR fetch_github_profile() via GitHub REST

Step 4 — Score + outreach (Featherless × 3 concurrent):
  score_and_write_outreach(profile, jd_parsed, weights, featherless_api_key)
  → httpx POST featherless → profile_score + outreach_email
  → retry once on malformed JSON

Step 5 — DB persist:
  OutboundCandidate rows → campaign.status="complete"
```

## Fallback Paths (No Fake Data)

There are NO mock/fake/hardcoded data fallbacks in any service. All fallback
paths are real external API calls:
- `use_brightdata=False` → falls back to GitHub REST API (also real, just rate-limited)
- Missing api_key → now raises ValueError immediately (pre-flight guard) instead
  of silently sending empty Bearer header

## What "Fake" Behavior Looked Like

The system appeared to have fake AI behavior because:
1. JD Analysis returned 502 errors → HR portal showed no weight suggestions
2. Scoring SSE completed but emitted candidate_error events with score=0 →
   rankings showed all zeros
3. Outbound campaign showed "running" briefly then "error" →
   looked like it ran but found nothing
