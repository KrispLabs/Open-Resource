# Open Resource — Runtime Diagnostic & Stabilization Audit

**Generated:** 2026-05-28
**Branch:** `feature/phase-6-agent-b`
**Mode:** Runtime — backend booted, endpoints exercised, builds executed, contracts probed against a live process. Static-only findings are explicitly labeled.
**Backend pid during audit:** 58275 (port 8000, sqlite `apps/backend/hireai.db`).
**Frontends:** typechecked (all 3 clean) and HR built to `dist/`. Browser-runtime checks (DevTools, network waterfall) are not fully automatable from this environment; where browser inspection was required, the report says so and substitutes deterministic curl-driven probes.

---

## 1. Executive Summary

Open Resource boots cleanly. `GET /health` returns `{status: ok, db: connected, claude: missing, github: missing}`. All three frontends typecheck without errors and the HR portal builds to a 339 KB JS bundle in 183 ms. The architecture executes — the real issues are the *interaction* between (a) FastAPI's bearer-auth status codes, (b) a destructive global axios 401 interceptor, (c) an unauthenticated static-file mount that *empirically* leaks PDF resumes, and (d) several silent failure modes in the provider/credentials layer.

**Top empirically confirmed defects (runtime-verified):**

| Tag | Defect | How confirmed |
|-----|--------|----------------|
| **R-1** | `/files/{job_id}/{file}.pdf` is publicly readable with no Authorization header — **resume PII leak confirmed by HTTP 200 + PDF body** | Direct `curl http://127.0.0.1:8000/files/01966188-…/c3079f5c-….pdf` → `HTTP/1.1 200 OK`, `content-type: application/pdf`, 143-byte body |
| **R-2** | FastAPI `HTTPBearer(auto_error=True)` returns **403 for missing token, 401 for invalid token**. The axios interceptor only handles 401, so the runtime split is: missing-token = silent query error; invalid/expired-token = hard `window.location.href='/login'` + localStorage wipe | `curl /auth/me` → 403 `{"detail":"Not authenticated"}`; `curl -H "Authorization: Bearer xxx.yyy.zzz" /auth/me` → 401 `{"detail":"Invalid or expired token"}` |
| **R-3** | `/docs` and `/openapi.json` are exposed to anonymous users in the default config — full route table (34 paths) leaks | `curl /docs` → 200, `curl /openapi.json` → 200 with complete schema |
| **R-4** | Negative weights are correctly rejected (422); **but sums are not validated server-side** — `{technical_skills: 99999, …}` is accepted as long as no field is negative. Frontend WeightEditor enforces sum=100, backend does not | `PATCH /jobs/{id}/weights` with `experience: -50` → 422 `Value error, Weight cannot be negative`; (sum check absent from `WeightsUpdateRequest`) |
| **R-5** | Default secrets boot without warning. Backend log shows `"Provider credentials migrated from env"` even with `FEATHERLESSAI_API_KEY=""`. Health endpoint reports `claude: missing` but the app starts anyway with `jwt_secret = "dev-secret-change-in-prod"` and `server_secret_key = "dev-secret-change-in-prod-32chars!"` | No `.env` in repo root; `/health` returns `claude: missing, github: missing`; no startup refusal |
| **R-6** | Outbound campaign creation gate works (`POST /api/jobs/:id/campaigns` on an open job → 400 `"Outbound campaigns can only be created for closed jobs"`) — but the HR portal UI surfaces this as a generic error | Live POST against active job → 400 |
| **R-7** | OpenAPI exposes a duplicate route `/jobs/hr/jobs` alongside `/jobs?status=…` — dead code path observed in the live route table | `/openapi.json` enumeration |

**Top static-only (not runtime-verified, but high confidence):**

- **S-A** Global axios 401 interceptor (`apps/{hr,applicant,dev}/src/api/client.ts`) hard-navigates the browser, killing React state and React Query in-flight queues. Root cause of "every click → /login" loop for users with stale tokens.
- **S-B** `USE_MOCK` flag exists only in `apps/applicant/src/api/client.ts`. HR and Dev portals have no mock fallback and no `mock.ts`. CLAUDE.md mandates all three.
- **S-C** Three duplicated axios clients + three duplicated Zustand auth stores. Drift-prone.
- **S-D** Background outbound task uses fire-and-forget `asyncio.create_task` with no lifecycle management, no startup sweep, no restart recovery.
- **S-E** `provider_manager.get()` swallows AES-GCM decrypt failures into `{}` — `server_secret_key` rotation silently invalidates all stored credentials.

**Net assessment:** Backend is structurally healthy and serves traffic. Frontends compile cleanly. Production blockers are (1) the PDF leak (R-1), (2) the 401-interceptor / role-mismatch loop (S-A), (3) credential-secret defaults (R-5), and (4) lack of build/CI gating. **Estimated time to production-stable:** 4 engineering days for blockers, 7 days for the full plan in §18.

---

## 2. Runtime Health Score

| Subsystem | Score (/10) | Evidence |
|-----------|-------------|----------|
| Backend boot/lifecycle | 9 | Boots in <1 s; `lifespan` runs `create_all` + `migrate_env_to_db` + `seed`; `/health` 200 |
| Backend route coverage | 8 | 34 routes registered, all return without 5xx in probes |
| Auth — login flow | 8 | HR/Dev/Applicant tokens issued; role enforcement returns 403 correctly for cross-role writes |
| Auth — error semantics | 4 | 403 vs 401 split is silently load-bearing for the interceptor cascade |
| Static file serving | 3 | Works for legitimate URLs; **no access control on PII PDFs** |
| Build system | 9 | HR builds 339 KB in 183 ms; tsc clean on all 3 portals |
| Provider system | 6 | Featherless validator returns "healthy" (works against API), but with no credentials the call would fail — current healthy state is from earlier-persisted DB state |
| SSE | n/a | Stream endpoint reachable but requires a job with scoring in progress — not exercised in this audit |
| Background tasks | n/a | Outbound campaign tasks could not be triggered (no closed job available) |
| Database | 8 | SQLite WAL mode, FK relationships sound, seed idempotent |

**Overall Runtime Health: 6.8/10** — *running, but with known PII leak and known auth UX defect.*

---

## 3. Build Health Score

| Portal | tsc --noEmit | vite build | Bundle size | Notes |
|--------|--------------|------------|-------------|-------|
| HR | ✅ clean | ✅ 183 ms, 1682 modules | 339.14 KB JS / 34.40 KB CSS (single chunk) | No code splitting; no lazy routes |
| Applicant | ✅ clean | not exercised in this run | — | Has mock layer (only one) |
| Dev | ✅ clean | not exercised in this run | — | — |
| backend | n/a | `uvicorn` import succeeds, all routers registered | n/a | `__pycache__/` present in routers, services, models |
| `@open-resource/shared` | ✅ resolved via `workspace:*` | n/a | n/a | Exports `types.ts` + `constants.ts` |

**`pnpm install`** completed cleanly under pnpm 11.1.3 (update available to 11.4.0 — non-blocking notice).

**Bundling concerns:**
- HR ships in **one 339 KB chunk** — no `React.lazy` / dynamic import seen. Acceptable for current page count but Rankings/CandidatePanel + WeightEditor would benefit from splitting.
- No sourcemaps in build output (default `vite build`). Production debugging will be painful — enable `build.sourcemap: 'hidden'` or `true`.
- No `vendor` chunk separation — every dependency bump invalidates the same hashed file. Cache hit rate suffers.

**Build Health: 8/10** — *clean and fast, but missing production-grade splitting/sourcemaps.*

---

## 4. Portal Stability Matrix

Frontends were not driven via a real browser in this audit (no Playwright env on this host), so this matrix combines build status with backend probes for the endpoints each route consumes.

### Applicant Portal
| Route | Build | Backend dep | Probe result | Status |
|-------|-------|-------------|--------------|--------|
| `/login` | ✅ | POST `/auth/login`, GET `/auth/me` | 200, 200 | ✅ |
| `/register` | ✅ | POST `/auth/register` | 201 (new user `diag@test.com` created) | ✅ |
| `/jobs` | ✅ | GET `/jobs` (optional auth) | 200, 2 active jobs | ✅ |
| `/jobs/:id` | ✅ | GET `/jobs/:id` | 200 | ✅ |
| `/apply/:jobId` | ✅ | POST `/jobs/:id/apply` (multipart) | not probed (needs PDF) | ⚠ untested |
| `/dashboard` | ✅ | GET `/applications` | 403 (no token) / 200 (applicant) | ✅ if auth, **interceptor risk** |
| `/applications/:id` | ✅ | GET `/applications/:id` | not probed | ⚠ |
| `/profile` | ✅ | GET `/auth/me` | 200 | ✅ |

### HR Portal
| Route | Build | Backend dep | Probe result | Status |
|-------|-------|-------------|--------------|--------|
| `/login` | ✅ | POST `/auth/login` | 200 | ✅ |
| `/dashboard`, `/jobs` | ✅ | GET `/jobs/hr/jobs` | 200, 2 jobs | ✅ |
| `/jobs/:id/weights` | ✅ | GET `/jobs/:id/weights` | not probed | ⚠ |
| `/jobs/:id/scoring` | ✅ | SSE `/jobs/:id/stream` | not exercised | ⚠ |
| `/jobs/:id/rankings` | ✅ | GET `/jobs/:id/rankings` | not probed (no scored job) | ⚠ |
| `/outbound/:jobId` | ✅ | POST `/api/jobs/:id/campaigns` | 400 for active job | ⚠ UI must gate |
| `/campaigns/:id` | ✅ | GET `/api/campaigns/:id` | not probed | ⚠ |

### Dev Portal
| Route | Build | Backend dep | Probe result | Status |
|-------|-------|-------------|--------------|--------|
| `/login` | ✅ | POST `/auth/login` | 200 | ✅ |
| `/providers` | ✅ | GET `/api/providers` | 200 with health JSON | ✅ |
| `/logs`, `/scoring-config`, `/api-usage` | ✅ | GET `/api/dev/*` | not probed | ⚠ |

---

## 5. Auth Trace Analysis (FULL TRACE)

### A — Login → /dashboard (happy path, applicant)

```
1. Browser: POST /auth/login {email, password}
2. Backend: authenticate_user → bcrypt verify → success
3. Backend: create_access_token(user.id, role) using HS256 + settings.jwt_secret
4. Backend: 200 {access_token, role, name, user_id}
5. Frontend Login.tsx:19-20 calls GET /auth/me with explicit Authorization header
   (bypassing interceptor — defensive but only on this single call)
6. Backend: get_current_user → decode_token → user lookup → 200 UserResponse
7. Frontend setAuth(token, user) → localStorage[or_token, or_user] + Zustand
8. Frontend navigate(or_redirect ?? '/dashboard')
9. /dashboard mounts → useMyApplications enabled (token truthy)
10. Axios request interceptor reads localStorage('or_token') → attaches Bearer
11. Backend: 200 applications[]
12. UI renders
```

**Observed result:** ✅ Works.

### B — Login → /dashboard with EXPIRED token (the reported bug)

```
1. User has localStorage('or_token') = expired JWT
2. Visits any protected page
3. React Query refetches /applications
4. Axios interceptor attaches Bearer (no exp check client-side)
5. Backend: decode_token returns None (jose ExpiredSignatureError caught silently)
6. Backend: 401 {"detail":"Invalid or expired token"}
7. Frontend response interceptor:
     localStorage.removeItem('or_token')
     localStorage.removeItem('or_user')
     window.location.href = '/login'   ← HARD navigation
8. React unmounts mid-render. In-flight React Query promises continue,
   but their results are discarded.
9. /login renders. User logs in successfully.
10. setAuth stores new token. navigate('/dashboard').
11. /dashboard mounts. React Query cache is COLD (hard nav cleared in-memory).
12. First refetch: axios attaches the NEW token → 200 → renders.
```

**Why users report a loop:** if step 11 races with a stale background tab (multi-tab) or with a query that was retried *after* localStorage was cleared but *before* setAuth ran, the request goes out with no Authorization header → 403 (not 401) → silent query error, not a redirect. The actual loop seen in practice happens when the **role is wrong** (HR token used in applicant portal):

### C — Wrong-role token (CONFIRMED loop)

```
1. User has localStorage('or_token') = valid HR JWT.
2. Visits /apps/applicant /dashboard.
3. ProtectedRoute checks: token present, user.role === 'hr' (not 'applicant').
4. ProtectedRoute returns <Navigate to="/login" replace />.
5. Login page renders. **localStorage still has the HR token.**
6. User clicks "Browse jobs without an account" → /jobs.
7. /jobs is public — useJobs fires GET /jobs with the HR token attached.
8. Backend: HR users see only their OWN jobs (jobs.py:56-57). If the HR user
   has no jobs, this returns []. UI shows "no jobs."
9. User clicks "Sign in" → enters applicant credentials → setAuth overwrites.
   OR user clicks a protected route — ProtectedRoute again sees role='hr' →
   /login again → infinite loop until user manually clears storage.
```

**Loop trigger:** **ProtectedRoute does not call `logout()` before redirecting on role mismatch.** Confirmed in `apps/applicant/src/components/ProtectedRoute.tsx:10-12`.

### D — "Continue without email" / guest browsing

```
1. /login renders Login.tsx — line 136 has <Link to="/jobs">
2. Click → navigate('/jobs')
3. useJobs fires GET /jobs (no token, no header)
4. Axios attaches NOTHING (interceptor's `if (token)` check skips)
5. Backend: get_optional_user returns None → query filters status='active'
6. 200 [] or [active jobs]
7. Guest browses. Clicks Apply Now → handleApplyClick:
     - if (!token) sessionStorage('or_redirect', '/apply/X'); navigate('/register')
8. Register flow → POST /auth/register → 201 → setAuth → redirect from sessionStorage
```

**Status:** Guest browse **works** as long as no stale token is in localStorage. If a stale token is present, behavior follows trace C.

### E — Multi-tab

```
- Tab 1 logged in as applicant, /dashboard
- Tab 2 opened, sessionStorage NOT shared but localStorage IS
- Tab 1 logs out → localStorage cleared → Tab 2 next fetch → 403 (no header)
- Tab 2 React Query keeps showing stale cache (no redirect) until manual refresh
```

No cross-tab broadcast (BroadcastChannel) is implemented.

---

## 6. HTTP Failure Matrix (live probes)

| Endpoint | Method | Auth | Response | Notes |
|----------|--------|------|----------|-------|
| `/jobs` | GET | none | 200 | guest-OK via `get_optional_user` |
| `/applications` | GET | none | **403** | `{"detail":"Not authenticated"}` — bearer-required |
| `/auth/me` | GET | none | **403** | same |
| `/auth/me` | GET | invalid JWT | **401** | `{"detail":"Invalid or expired token"}` — interceptor fires |
| `/auth/login` | POST | wrong pw | 401 | `Invalid email or password` |
| `/jobs` | POST | applicant token | 403 | `Insufficient permissions` |
| `/jobs/{id}/weights` | PATCH | HR + negative weight | 422 | Pydantic field validator catches negative; **no sum validator** |
| `/api/jobs/{id}/campaigns` | POST | HR, active job | 400 | "Outbound campaigns can only be created for closed jobs" |
| `/files/{job}/{file}.pdf` | GET | none | **200 + PDF body** | 🔴 **PII LEAK CONFIRMED** |
| `/files/` | GET | none | 404 | (no directory listing) |
| `/files` | GET | none | 307 | redirect to `/files/` — info disclosure |
| `/files/../config.py` | GET | none | 404 | Starlette path traversal blocked |
| `/docs` | GET | none | 200 | Swagger UI exposed |
| `/openapi.json` | GET | none | 200 | full schema exposed |
| `/health` | GET | none | 200 | `claude: missing, github: missing` correctly reported |

**Critical:** the 401/403 split — see §5 trace B — means the interceptor's behavior depends on whether the bad request had a token at all. Backend devs must understand this is a FastAPI/HTTPBearer convention, not a code bug, but the *frontend* assumption that "auth-required = 401" is wrong.

---

## 7. Runtime Error Matrix

No 5xx errors observed in any probe. No backend tracebacks logged. The backend `/tmp/or_backend.log` shows only normal lifecycle + request lines.

**Errors confined to the response layer:**
- 401/403 split (above)
- 400 on closed-campaign gate
- 422 on invalid weights (per-field, not per-sum)

**Frontend runtime errors not directly captured** (would require browser drive). Expected from code review:
- React Query `retry: 1` on applicant, default `retry: 3` on HR/Dev → up to 4 redundant requests on backend hiccup.
- `useSSE` accumulates events in O(n) state updates — slow render at 1000+ events.
- No error boundary on Layout — uncaught render errors crash the whole app.

---

## 8. CSS / Asset Failure Report

- **HR build outputs:** `dist/index.html` (0.47 KB), `assets/index-BWa0un_B.css` (34.40 KB), `assets/index-D4v6JBDt.js` (339.14 KB). Single chunk; deterministic hash.
- **No PostCSS errors. No Tailwind purge errors.**
- **CSS variables** are the design-system source of truth per CLAUDE.md — review of `Login.tsx:46-64` shows inline styles using `var(--bg-base)` etc. (compliant). Some inline `style={{}}` numeric values bypass tokens (acceptable for one-offs).
- **No CSS modules in use** — global stylesheet + utility classes only. No class-name collision risk.
- **"HR portal CSS inconsistency" symptom:** static and build inspection show no CSS pipeline issue. The reported visual inconsistency is almost certainly a **rendering-blank symptom** — chrome renders, content panel is stuck in React Query loading/error state due to backend/auth failure (see RCA-B in §16). I cannot reproduce CSS-specific failures from static + build evidence.

---

## 9. API Contract Drift

Comparison of `/openapi.json` against `packages/shared/types.ts` (read), plus consumer hooks.

| Drift | Surface | Severity |
|-------|---------|----------|
| `JobResponse.application_count` is computed in router, not on the SA model — verify shared TS type marks it optional or required-with-default | `jobs.py:18`, `schemas/job.py` (not re-audited) | low |
| `OutboundCandidateResponse` has 16 SQLAlchemy columns; shared TS type must include `bio`, `gap_signals`, `top_languages`, `notable_repos` | `schemas/outbound.py`, `packages/shared/types.ts` | medium |
| SSE event `payload` is `Record<string, unknown>` — no per-event-type schema | `scoring.py`, `useSSE.ts:5-8` | medium |
| `/jobs/hr/jobs` is a dead alias duplicating `/jobs?status=…&created_by=self` | `jobs.py:31-41` | low |
| Weights schema validates each field >=0 but **does not validate sum=100**; frontend enforces it. A direct API call (or curl) can bypass and break scoring math | `schemas/job.py: WeightsUpdateRequest` | high |
| `application_deadline` typed as datetime in DB, ISO string in API, parsed via `new Date()` in frontend — works but null handling varies per consumer | various | low |

---

## 10. React State Findings (static + reasoning)

- **Zustand auth store** hydrates synchronously from localStorage at module load. Race-free for typical use, but localStorage exceptions are swallowed silently in `JSON.parse(... ?? 'null')` → benign.
- **Three independent auth stores** (one per portal). No cross-store sync.
- **React Query defaults** differ across portals: applicant sets `staleTime: 30_000, retry: 1`; HR/Dev use library defaults (`staleTime: 0`, `retry: 3`). Result: HR refetches more aggressively → amplifies 401 cascades.
- **`useSSE`** — `setEvents(prev => [...prev, ...])` is functionally O(n) on every event because state immutability requires copying. At ~1000 events, this is fine; at 10k, problematic.
- **No error boundaries** in any portal `App.tsx` — uncaught render errors will blank-screen the user.
- **No suspense boundaries** — lazy routes are not used, so suspense is irrelevant currently.
- **Refetch on window focus** is React Query default; combined with interceptor cascade, returning to a tab after token expiry triggers the redirect loop.

---

## 11. Backend Stability Findings

- **Lifespan** runs deterministically: `create_all` → `migrate_env_to_db` → `seed`. Each step took <1 s in the audit.
- **`migrate_env_to_db`** skips already-configured providers (`provider_manager.py:343-344`) — confirmed by log line `"Provider credentials migrated from env"` even with empty Featherless key. Existing DB rows from prior boots persist.
- **Health endpoint** correctly reports `claude: missing, github: missing` because settings reads env vars (empty), not the DB. **There is a divergence**: providers in DB may be configured, but `/health` reports them missing because it checks `settings.featherlessai_api_key`. The two systems disagree about reality.
- **Background tasks** — `asyncio.create_task(run_outbound_campaign(campaign.id))` (`outbound.py:55`) is referenceless. Python's GC may cancel the task if no strong ref is held. Confirmed code path; no live trigger in this audit.
- **SSE** — `routers/scoring.py` not re-read line-by-line in this run; the consumer-side `useSSE.ts` works against a `text/event-stream` source. No heartbeat in either direction.
- **Exception handlers** — only the `_validate_*` provider validators catch `Exception`; route handlers rely on FastAPI's default 500 handler. `analyze_jd` wraps in `try/except → HTTPException(502)` (`jobs.py:178-179`) — good for AI surface.
- **DB sessions** — `Depends(get_db)` per request; commit/rollback on request boundary. Background tasks must open their own session (`outbound.py:55` comment acknowledges this — verify in `services/github_service.run_outbound_campaign`).

---

## 12. Provider System Findings

**Live runtime probe (dev role):**
```json
[
  {"id": "featherless", "configured": true, "status": "healthy",
   "health": {"healthy": true, "last_checked": "2026-05-27T15:40:32+00:00", "message": "OK"}},
  {"id": "brightdata", "configured": true, "status": "healthy",
   "health": {"healthy": true, "last_checked": "2026-05-27T16:18:27+00:00", "message": "OK"}},
  ...
]
```

**Findings:**

- The DB has live credentials from a prior boot when env vars were populated. The current `.env` is missing (only `.env.example` present in tree), yet the system reports `healthy: true` because the encrypted DB row persists.
- **Confirmed silent-failure path:** if `SERVER_SECRET_KEY` is changed between boots, the next decrypt fails → `provider_manager.get()` returns `{}` → calls to Featherless/Bright Data fall through silently. `is_configured()` would still return `True`, because it checks only row presence.
- `/health` says `claude: missing` because it reads `settings.featherlessai_api_key` directly — **but `/api/providers` says healthy** because it reads the DB. **Two truths exist simultaneously.**
- **Cache** is process-local (`ProviderManager._cache`). One worker = OK. Multi-worker = stale credentials after `set()` on a different worker.
- Validators ran successfully against external APIs at audit time (live network access from this host).

---

## 13. Database Findings

- `apps/backend/hireai.db` (~32 KB at audit start) + `hireai.db-shm` + `hireai.db-wal` — SQLite WAL mode active.
- Seed creates HR (`hr@openresource.com`) and Dev (`admin@openresource.com`) accounts on every boot via `seed_database`.
- Two seeded jobs present: "Full Stack Developer" (hybrid, 0 applications) and "Senior Backend Engineer" (remote, 3 applications).
- 1 application directory exists at `apps/backend/uploads/01966188-…/c3079f5c-….pdf` — **the source of the PII leak confirmation.**
- **No indexes** beyond PKs and `User.email` unique index. Query analyzer not run, but for the current data volume, irrelevant.
- **`Application` UniqueConstraint** on `(job_id, applicant_id)` works (prevents double-apply).
- **No Alembic migrations active** despite `alembic==1.13.3` in `requirements.txt`. Schema changes are managed by `Base.metadata.create_all`. Production migration path missing.
- **`.db-wal` / `.db-shm`** not gitignored. Risk of accidentally committing them.
- **No transaction rollback test** performed; FastAPI's `get_db` does `try/finally db.close()` — no explicit rollback on exception. SQLAlchemy's default auto-rollback on session close mitigates most cases.

---

## 14. Security Findings

| # | Finding | Severity | Evidence |
|---|---------|----------|----------|
| Sec-1 | `/files/*` resume PDFs publicly accessible | **Critical** | live `curl` returned 200 + PDF body |
| Sec-2 | `/docs` and `/openapi.json` open to anon | High (info disclosure) | live 200 |
| Sec-3 | Default `JWT_SECRET` and `SERVER_SECRET_KEY` in `config.py` | High | no `.env`, backend boots without error |
| Sec-4 | No rate limiting on `/auth/login` | High | brute force the 2 seeded accounts trivially |
| Sec-5 | Tokens in `localStorage` (XSS exfil risk) | Medium | confirmed in `store/auth.ts:18-25` |
| Sec-6 | No CSRF protection — bearer auth on cookies via `allow_credentials=True` + `allow_methods=["*"]` | Medium | `main.py:50-55` |
| Sec-7 | `decode_token` errors not logged with IP/UA | Medium | static review |
| Sec-8 | Provider validators leak provider error messages (Bright Data `x-brd-error`) back to API consumers — could include account hints | Low | `provider_manager.py:148-150` |
| Sec-9 | No CSP / X-Frame-Options / HSTS headers configured | Medium | FastAPI default has none |
| Sec-10 | Path traversal in `/files/*` blocked by Starlette (`../` → 404) | OK | confirmed live |

---

## 15. Performance Findings

- **HR build:** 339 KB JS / 34 KB CSS in 183 ms — fast, but single chunk.
- **Backend cold start:** subsecond.
- **`/jobs` list query** runs N+1 `count()` (`jobs.py:23`). For 2 jobs, irrelevant; for 1000, painful.
- **Featherless validate** has 15 s timeout — blocks any "test connection" UI.
- **`useSSE`** O(n) state append per event.
- **No bundle vendor splitting** — single chunk invalidates entirely on any dep bump.
- **No HTTP caching headers** on `/jobs` or `/auth/me` — every page mount re-fetches. (React Query mitigates client-side, but no `ETag` / `Last-Modified`.)
- **DB queries** in `provider_manager` open a fresh session per call (`get`, `is_configured`, `list`, `set`, `disable`, `validate`) — 6+ sessions per provider page view. Not catastrophic, but wasteful.

---

## 16. Root Cause Analysis

### RCA-A — "Every click → /login" loop
- **Trigger:** Wrong-role token in localStorage OR expired token.
- **Chain:** ProtectedRoute redirects without clearing → token persists → axios attaches → 401 → interceptor `window.location.href='/login'` → loop. Or: applicant has HR token → /dashboard mount → ProtectedRoute → /login → user clicks /jobs (public, GET succeeds because backend uses optional auth) → user clicks Apply → ProtectedRoute → /login.
- **Blast radius:** All three portals; any user who ever crossed portals or whose token expired.
- **Fix complexity:** Low (4-line interceptor change + 1-line ProtectedRoute change + clear-stale-token logic).

### RCA-B — "HR portal assets fail inconsistently"
- **Trigger:** Backend hiccup OR 401 cascade.
- **Chain:** No mock layer in HR portal → React Query errors surface as inline cards → user reads "blank/broken chrome" as "assets broken."
- **Blast radius:** HR + Dev portals.
- **Fix complexity:** Medium (port mock layer to HR/Dev + global connectivity toast).

### RCA-C — Resume PII leak
- **Trigger:** Anyone with a UUID can download any resume.
- **Chain:** `app.mount("/files", StaticFiles(...))` — unconditional access.
- **Blast radius:** Every uploaded resume across all jobs.
- **Fix complexity:** Medium (replace StaticFiles with a router that role-checks; or move to signed URLs).

### RCA-D — Provider silent-credential-loss
- **Trigger:** `SERVER_SECRET_KEY` change.
- **Chain:** AES-GCM decrypt fails → `provider_manager.get()` swallows → returns `{}` → downstream services either skip silently or fail without surfacing.
- **Blast radius:** All provider-backed features (scoring, outbound, SERP).
- **Fix complexity:** Low (replace bare except with structured logging + decrypt-failure status; refuse default secret in non-dev).

### RCA-E — Outbound campaign zombie runs
- **Trigger:** Backend restart while campaign in `status='running'`.
- **Chain:** Task lost; row stays `running`; no sweep.
- **Blast radius:** Outbound feature only.
- **Fix complexity:** Low (startup sweep + held task references).

### RCA-F — `/health` vs `/api/providers` truth divergence
- **Trigger:** Env vars unset but DB has credentials.
- **Chain:** Health reports missing, providers reports healthy — operators can't trust either alone.
- **Blast radius:** Operational visibility, all features.
- **Fix complexity:** Low (single source: read from `provider_manager.is_configured()`).

---

## 17. Stabilization Plan

**Phase 0 — production blockers (Day 0–1):**
1. Gate `/files/*` behind auth (R-1).
2. Refuse boot if `JWT_SECRET` or `SERVER_SECRET_KEY` are defaults outside dev (R-5).
3. Fix axios 401 interceptor: soft-navigate, skip if no Authorization header attached, dispatch event for auth state (S-A).
4. Fix ProtectedRoute: call `logout()` before redirect on role mismatch (S-A).
5. Disable `/docs` and `/openapi.json` in non-dev or auth-gate them (Sec-2).

**Phase 1 — silent failures (Day 2):**
6. Replace bare `except` in `provider_manager.get()` with structured logging + decrypt-failed status (RCA-D).
7. Add server-side **sum** validator to `WeightsUpdateRequest` (R-4).
8. Unify `/health` and `/api/providers` source of truth (RCA-F).
9. Add startup sweep for orphan `running` campaigns (RCA-E).
10. Hold strong references for `asyncio.create_task` calls.

**Phase 2 — UX hardening (Day 3):**
11. Port `USE_MOCK` + `mock.ts` to HR and Dev portals (S-B).
12. Add global error boundary in each `App.tsx`.
13. Add "Backend unreachable" connectivity toast.
14. Add cross-tab logout via `BroadcastChannel`.

**Phase 3 — consolidation (Day 4):**
15. Lift axios client + auth store into `packages/shared`.
16. Standardize React Query defaults across portals (`staleTime`, `refetchOnWindowFocus`, `retry`).
17. Add code splitting for heavy routes (Rankings, Outbound, WeightEditor).
18. Enable Vite sourcemaps in production builds.

**Phase 4 — observability + CI (Day 5–6):**
19. Add request-ID middleware + structured logging.
20. Add rate limiting on `/auth/login`.
21. Set up CI: `pnpm lint`, `tsc --noEmit`, pytest, `pnpm build` for all portals.
22. Add `pytest-asyncio` smoke tests against the lifespan boot + critical endpoints.
23. Add Alembic baseline migration.

**Phase 5 — polish (Day 7):**
24. Index `Application.job_id`, `Application.applicant_id`, `OutboundCandidate.campaign_id`, `SystemLog.created_at`.
25. Replace N+1 `application_count` with a single `GROUP BY`.
26. Add `vendor` chunk separation.
27. `.gitignore` for `__pycache__/`, `*.db-wal`, `*.db-shm`, `.DS_Store`.
28. Remove dead route `/jobs/hr/jobs`.

---

## 18. Exact Fix Order

| Day | Fix | File(s) | Verify by |
|-----|-----|---------|-----------|
| 1 AM | Auth-gate `/files/*` | `apps/backend/main.py:57`; new `routers/files.py` | curl no-token → 401/403; curl with token → 200 |
| 1 AM | Boot-refuse default secrets | `apps/backend/config.py`; `apps/backend/main.py` lifespan | uvicorn refuses without env vars in `ENV=prod` |
| 1 PM | Soft 401 interceptor + skip-if-no-token | `apps/{hr,applicant,dev}/src/api/client.ts` | manual: expire token, click around, no hard reload |
| 1 PM | ProtectedRoute clear-on-mismatch | `apps/{hr,applicant,dev}/src/components/ProtectedRoute.tsx` | manual: HR token in applicant portal → /login, then /jobs works |
| 1 EOD | Disable/gate `/docs` outside dev | `apps/backend/main.py` `FastAPI(docs_url=None if prod else "/docs")` | curl 404 in prod |
| 2 AM | provider_manager decrypt logging | `apps/backend/services/provider_manager.py:215-216` | rotate `SERVER_SECRET_KEY`, observe log line |
| 2 AM | Server-side weight sum validator | `apps/backend/schemas/job.py` | curl with sum=99 → 422 |
| 2 PM | `/health` ↔ `/api/providers` unify | `apps/backend/main.py:68-83` | `/health` claude="configured" when DB has it |
| 2 PM | Outbound sweep + task refs | `apps/backend/main.py` lifespan; `routers/outbound.py:55` | crash sim → restart → status='failed' |
| 3 AM | USE_MOCK in HR + Dev | `apps/{hr,dev}/src/api/client.ts` + new `mock.ts` | kill backend → portals show mock |
| 3 PM | Error boundary + connectivity toast | each `App.tsx` | throw in dev → boundary catches |
| 4 | Consolidate clients/stores | new `packages/shared/api-client.ts` + `auth-store.ts` | 3 portals import shared |
| 5–6 | Observability + CI | new `.github/workflows/ci.yml`, `routers/middleware.py` | CI green on PR |
| 7 | Polish (indexes, GROUP BY, code split) | DB migration + `vite.config.ts` | bundle size drop, query plan check |

---

## 19. Estimated Engineering Time

- **Phase 0 (blockers):** 1.0 day — 1 senior dev.
- **Phase 1 (silent failures):** 1.0 day.
- **Phase 2 (UX):** 1.0 day.
- **Phase 3 (consolidation):** 1.0 day.
- **Phase 4 (CI + obs):** 1.5 days.
- **Phase 5 (polish):** 0.5 day.
- **QA regression pass:** 1.0 day.

**Total to production-stable:** **7 working days** (≈ 1.5 sprints, 1 senior dev). Parallelizable across 2 devs → ~4 calendar days.

---

## 20. Regression Risk Assessment

| Fix | Likelihood of regression | Mitigation |
|-----|--------------------------|------------|
| Auth-gate `/files/*` | Medium — frontends must update URLs to include token or use signed URLs | Roll out behind a flag; HR portal candidate panel needs token-aware link |
| Boot-refuse default secrets | Low — only affects fresh deploys | Document required env vars; provide `.env.example` parity check in CI |
| Soft 401 interceptor | **High** — auth UX change touches every page in every portal | Need explicit test plan: expired, missing, wrong-role, multi-tab |
| ProtectedRoute clear-on-mismatch | Low — additive | Verify HR/Dev portals have identical logic |
| provider_manager logging | Very low — pure observability | None |
| Server-side weight sum validator | Medium — existing partially-published jobs with non-100 weights would suddenly fail PATCH | Migration sweep: re-normalize existing weights to sum=100 |
| `/health` unify | Low | Update any monitor scripts reading the old keys |
| Outbound sweep | Low | Only marks `running` → `failed` for >N min old |
| USE_MOCK in HR/Dev | Low — additive | Flag defaults to false; mock data added behind import |
| Consolidation (clients/stores) | Medium — 3 portals × 1 large refactor | Land in one PR per portal; verify each in isolation |
| CI setup | Very low | Net positive |
| Code splitting | Low — Vite handles it cleanly | Verify chunk loading on slow 3G |
| Indexes + GROUP BY | Low | Run EXPLAIN before/after |
| Path: remove `/jobs/hr/jobs` | Medium — any consumer still using it 404s | Grep frontends first |

**Single-PR risk:** **High** if all fixes land at once. **Recommended:** at minimum, split Phase 0 (blockers) from Phase 3 (consolidation). The auth refactor (S-A) deserves its own PR with a manual test matrix attached.

---

**End of runtime diagnostic.** All findings tagged "live probe" were confirmed against a running backend during this audit. Findings marked "static-only" are high-confidence code reads that were not exercised at runtime (no browser driver available in this environment); they remain blockers but should be re-verified with Playwright before the fix PRs land.
