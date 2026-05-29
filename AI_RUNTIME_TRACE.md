# AI Runtime Trace

All traces captured from system_logs table and live runtime tests.

## Trace A: JD Analysis

### Pre-fix execution trace
```
[18:59:33] POST /jobs/{id}/analyze
  → jd_analyzer.analyze_jd()
  → provider_manager.get("featherless") → {"model": "..."}  # no api_key
  → api_key = "" (fallback settings.featherlessai_api_key also "")
  → headers = {"Authorization": "Bearer "}
  → httpx.post() → raises IllegalHeaderValue before TCP connect
  → latency: 513ms (connection setup only)
  → system_log: jd_analysis / featherless / ERROR
    error_message: "Illegal header value b'Bearer '"
  → route raises HTTPException(502, "AI analysis failed: ...")
  → HR portal shows error toast
```

### Expected post-fix trace (with valid key)
```
POST /jobs/{id}/analyze
  → api_key = provider_manager.get("featherless").get("api_key")  # real key
  → model = provider_manager.get("featherless").get("model")
  → if not api_key: raise ValueError(...) — caught before HTTP
  → httpx.post(featherless, timeout=60s)
  → response: {"choices":[{"message":{"content":"{ ... JSON ... }"}}]}
  → json.loads() → normalize weights
  → DB: job.jd_parsed = parsed, job.scoring_weights = proposed_weights
  → system_log: jd_analysis / featherless / SUCCESS / tokens={N}
  → route returns JobResponse with jd_parsed populated
```

## Trace B: Candidate Scoring (SSE)

### Pre-fix execution trace
```
POST /jobs/{id}/score → 200 OK (validation only, no AI work)
GET /jobs/{id}/stream (SSE)
  → yield session_start {total: N}
  → yield step "Scoring N candidates..."
  → asyncio.Semaphore(5), create_task for each application
  → score_candidate(app, ...)
    → extract_text_from_pdf(resume_path) → resume_text
    → provider_manager.get("featherless") → no api_key → ValueError raised
    → score = CandidateScore NOT created
    → queue.put(("candidate_error", name, index, "ValueError: Featherless API key not configured"))
  → yield candidate_done {name, score: 0, verdict: "rejected", error: "..."}
  → completed += 1
  → all N candidates fail with score=0 / rejected
  → session_done {shortlisted: 0, not_shortlisted: N, reviewing: 0}
  → rankings: all rank by submitted_at, all score=0, all rejected
```

### Expected post-fix trace (with valid key)
```
GET /jobs/{id}/stream (SSE)
  → session_start {total: N}
  → for each application (Semaphore 5):
    → extract_text_from_pdf → text
    → featherless POST (timeout 90s)
    → parse JSON → weighted_total computation
    → CandidateScore written to DB
    → candidate_done {name, score: 73.4, verdict: "shortlisted", index: 3}
  → finalize: rank by weighted_total DESC, apply shortlist_cutoff
  → session_done {shortlisted: K, not_shortlisted: M, reviewing: R}
```

## Trace C: Outbound Campaign (Bright Data path)

### Pre-fix execution trace
```
POST /api/jobs/{id}/campaigns
  → no pre-flight checks
  → OutboundCampaign row created (status="running")
  → asyncio.create_task(run_outbound_campaign(campaign_id))
  → 201 response to frontend

Background task:
  → provider_manager.get("featherless") → {"model": "..."}  # no api_key
  → featherless_api_key = ""
  → extract_github_signals(jd_parsed={}, featherless_api_key="")
    → httpx.post() with "Authorization: Bearer "
    → raises IllegalHeaderValue (latency ~0ms — never sent)
  → campaign.status = "error"
  → system_log: outbound_signals / featherless / ERROR / "Illegal header value b'Bearer '"

Frontend: polls every 3s → sees status="error" after ~3 seconds
```

### Post-fix execution trace (Featherless key configured)
```
POST /api/jobs/{id}/campaigns
  → pre-flight: provider_manager.get("featherless").get("api_key") → present ✓
  → pre-flight: brightdata api_key present ✓
  → pre-flight: job.jd_parsed not None ✓
  → job.status "closed" → "sourcing"
  → OutboundCampaign(run_number=1) created
  → asyncio.create_task(run_outbound_campaign(campaign_id))

Background task:
  Step 1 — Signal extraction:
    → extract_github_signals(jd_parsed, featherless_api_key)
    → featherless POST → {"search_queries": ["language:python fastapi stars:>50", ...]}
    → campaign.github_search_signals = signals

  Step 2 — Bright Data SERP search:
    → for each query in search_queries:
      → search_candidates_serp(query, brightdata_api_key, "serp_api2")
      → POST https://api.brightdata.com/request
      → zone: serp_api2, url: google.com/search?q=site:github.com+language:python+fastapi+stars:>50
      → parse organic → [{login: "tiangolo", ...}, {login: "encode", ...}]
    → deduplicate by login → all_users dict

  Step 3 — Profile enrichment (Bright Data dataset):
    → fetch_profiles_dataset(usernames, brightdata_api_key, dataset_id)
    → POST https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_m794s4jrlq1bvkfnt
    → poll snapshot until 200 (up to 120s)
    → returns enriched profile objects

  Step 4 — Score + outreach (Featherless × 3 concurrent):
    → score_and_write_outreach(profile, jd_parsed, weights, featherless_api_key, hr_name)
    → featherless POST → {"profile_score": 82, "matched_signals": [...], "outreach_email": "Hi tiangolo..."}
    → retry once on malformed JSON

  Step 5 — Persist:
    → OutboundCandidate rows saved
    → campaign.status = "complete"
    → campaign.total_found = N

Frontend: polls every 3s → sees status="complete" → loads candidates
```

## Timing Profile (expected with valid keys)

| Step | Provider | Typical latency |
|------|----------|----------------|
| JD Analysis | Featherless | 3-8s |
| Signal extraction | Featherless | 2-5s |
| SERP search (per query) | Bright Data | 3-8s |
| Profile dataset | Bright Data | 15-60s (snapshot) |
| Profile scoring + outreach (per candidate) | Featherless | 4-10s |
| Candidate scoring (per candidate) | Featherless | 5-15s |
| SSE stream for 10 candidates (5 concurrent) | — | ~20-40s total |
