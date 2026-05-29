# Open Resource — Stabilization Fix Plan

**Status:** In progress | **Branch:** feature/phase-6-agent-b | **Date:** 2026-05-28

This document tracks every stabilization fix applied during the production hardening sprint. Consult `DIAGNOSTIC_REPORT.md` for the root cause analysis behind each item.

---

## Phase 0 — Critical Blockers (Day 1)

| # | Fix | File(s) | Status | Root Cause |
|---|-----|---------|--------|------------|
| P0-1 | Authenticated file serving — remove public StaticFiles mount | `apps/backend/main.py`, NEW `apps/backend/routers/files.py` | Done | Resume PDFs were publicly accessible (HTTP 200, no auth) |
| P0-2 | Soft 401 interceptor — replace `window.location.href` with custom event | `apps/{hr,applicant,dev}/src/api/client.ts` | Done | Hard navigation aborted React state, caused redirect loops |
| P0-3 | Token expiry pre-check in request interceptor | `apps/{hr,applicant,dev}/src/api/client.ts` | Done | Expired tokens caused 401 cascades instead of graceful logout |
| P0-4 | ProtectedRoute — call `logout()` before redirect on role mismatch | `apps/{hr,applicant,dev}/src/components/ProtectedRoute.tsx` | Done | Wrong-role tokens persisted, causing infinite redirect loops |
| P0-5 | AuthSync component — soft navigation + cross-tab BroadcastChannel | NEW in each portal `src/components/AuthSync.tsx` | Done | No mechanism to respond to session-expired events without hard navigation |
| P0-6 | Startup secret enforcement warning + production refusal | `apps/backend/main.py` | Done | Default insecure secrets could reach production silently |

---

## Phase 1 — Silent Failures (Day 2)

| # | Fix | File(s) | Status | Root Cause |
|---|-----|---------|--------|------------|
| P1-1 | Provider decrypt failure: structured logging + `decrypt_failed` status | `apps/backend/services/provider_manager.py` | Done | `except Exception: return {}` silenced all credential errors |
| P1-2 | `is_configured()` returns False when status is `decrypt_failed` | `apps/backend/services/provider_manager.py` | Done | UI showed "configured" even when credentials were unreadable |
| P1-3 | `/health` reads from `provider_manager.is_configured()` | `apps/backend/main.py` | Done | `/health` and `/api/providers` disagreed on provider state |
| P1-4 | Orphan campaign recovery on startup | `apps/backend/main.py` | Done | Campaigns stuck in `running` state after backend restart |
| P1-5 | Background task reference tracking | `apps/backend/routers/outbound.py` | Done | Fire-and-forget `asyncio.create_task` could be GC'd mid-run |
| P1-6 | Rate limiting on `/auth/login` and `/auth/register` | `apps/backend/routers/auth.py` | Done | No brute-force protection on seeded demo accounts |
| P1-7 | Security headers middleware | `apps/backend/middleware.py` | Done | No X-Frame-Options, X-Content-Type-Options, etc. |
| P1-8 | Request ID middleware | `apps/backend/middleware.py` | Done | No correlation ID for tracing failures across logs |
| P1-9 | Remove dead `/jobs/hr/jobs` alias route | `apps/backend/routers/jobs.py` | Done | Duplicate route duplicated filter logic |
| P1-10 | DB indexes on hot FK columns | `apps/backend/models/models.py`, `apps/backend/main.py` | Done | No indexes on `Application.job_id`, `applicant_id`, `SystemLog.created_at` |

---

## Phase 2 — UX & Frontend Hardening (Day 3)

| # | Fix | File(s) | Status | Root Cause |
|---|-----|---------|--------|------------|
| P2-1 | Global ErrorBoundary in all 3 portals | `apps/{hr,applicant,dev}/src/components/ErrorBoundary.tsx` | Done | Uncaught render errors caused blank-screen with no recovery |
| P2-2 | `refetchOnWindowFocus: false` in all QueryClients | `apps/{hr,applicant,dev}/src/App.tsx` | Done | Tab-switch refetch triggered 401 cascades |
| P2-3 | `USE_MOCK` + `mock.ts` for HR and Dev portals | `apps/{hr,dev}/src/api/client.ts`, `mock.ts` | Done | HR/Dev had no fallback when backend unreachable |
| P2-4 | SSE reconnect with exponential backoff + idle detection | `apps/hr/src/hooks/useSSE.ts` | Done | No reconnect on dropped connection; idle stream looked like stuck |
| P2-5 | BroadcastChannel cross-tab logout sync | all portal `store/auth.ts` | Done | Logout in one tab left other tabs stale |

---

## Phase 3 — CI & Observability (Day 4–5)

| # | Fix | File(s) | Status | Root Cause |
|---|-----|---------|--------|------------|
| P3-1 | GitHub Actions CI pipeline | `.github/workflows/ci.yml` | Done | No automated lint/typecheck/build gate |
| P3-2 | `migrate_env_to_db` skip-warning | `apps/backend/services/provider_manager.py` | Done | Silent skip hid credential rotation issues |

---

## Remaining (Deferred)

| # | Fix | Priority | Notes |
|---|-----|----------|-------|
| D-1 | Shared axios client in `packages/shared` | Medium | Low-risk refactor; portals work correctly with per-portal clients for now |
| D-2 | Alembic baseline migration | Medium | `create_all` + `_ensure_db_indexes()` covers fresh + existing installs for now |
| D-3 | Disable `/docs` in production | Low | Gated by `APP_ENV=production` pattern already introduced; add FastAPI `docs_url=None` conditional if needed |
| D-4 | Signed URL pattern for file serving | Low | Current auth-gated `/files/{job_id}/{filename}` is correct; signed URLs add CDN support |
| D-5 | Vendor chunk splitting in Vite | Low | 339 KB single chunk is fine for current scale |
| D-6 | Backend connectivity toast in portals | Low | Error boundaries + React Query error states cover the main UX gap |

---

## Regression Risk Register

| Fix | Risk | Mitigation |
|-----|------|------------|
| Authenticated `/files/*` | HR portal candidate panel must attach token when rendering resume URLs; direct browser open from copied URL will 401 | Verify CandidatePanel and Rankings pages use auth-gated fetch, not bare `<a href>` |
| `refetchOnWindowFocus: false` | Some data may become stale if user leaves and returns | Acceptable trade-off vs. redirect loops; manual refresh always works |
| ProtectedRoute `logout()` on mismatch | Cross-portal users lose their session when visiting wrong portal | By design — each portal is role-isolated |
| Soft 401 (custom event) | If `AuthSync` is not mounted (e.g., on /login page itself), the event has no listener and the 401 is swallowed | The 401 is still returned to React Query which shows an error state; `/login` page doesn't make auth-required calls |
| Rate limiter (in-memory) | Rate state lost on restart; not shared across multiple workers | Acceptable for single-process dev/staging; use Redis-based limiter for multi-worker production |

---

## Test Checklist

### Auth flows
- [ ] Login with correct credentials -> /dashboard
- [ ] Login with wrong password -> inline error, no redirect
- [ ] Expired token (manually clear exp from localStorage) -> soft redirect to /login
- [ ] Wrong-role token in portal (set HR token in applicant portal) -> logout + /login, then /jobs works as guest
- [ ] Logout in Tab A -> Tab B shows /login within 2 seconds (BroadcastChannel)
- [ ] Multiple tabs: one tab 401 -> all tabs go to /login
- [ ] "Browse jobs without an account" -> /jobs loads, Apply Now redirects to /register

### File serving
- [ ] `curl /files/{job}/{file}.pdf` with no token -> 403
- [ ] Applicant `curl /files/{job}/{file}.pdf` with their own token -> 200 (their file)
- [ ] Applicant `curl /files/{other_job}/{file}.pdf` with their token -> 403
- [ ] HR `curl /files/{their_job}/{file}.pdf` with HR token -> 200
- [ ] HR `curl /files/{other_hr_job}/{file}.pdf` with HR token -> 403
- [ ] Dev `curl /files/{any_job}/{file}.pdf` with dev token -> 200

### Provider system
- [ ] Rotate `SERVER_SECRET_KEY`, restart backend -> logs show "credential decrypt failed" -> admin UI shows `decrypt_failed` status
- [ ] Re-configure via admin UI -> status recovers to `healthy`
- [ ] `/health` shows `claude: configured` when DB has Featherless configured
- [ ] `/health` shows `claude: missing` when DB has no Featherless

### Error boundaries
- [ ] Throw error in any page component -> ErrorBoundary renders with Reload button instead of blank screen

---

## Production Readiness Checklist

- [ ] `JWT_SECRET` set to a random 32+ char string in production environment
- [ ] `SERVER_SECRET_KEY` set to a random 32+ char string in production environment
- [ ] `APP_ENV=production` set in production environment (triggers startup secret enforcement)
- [ ] `FEATHERLESSAI_API_KEY` configured via `/api/setup` after first boot
- [ ] `GITHUB_TOKEN` or `BRIGHTDATA_API_KEY` configured via `/api/setup`
- [ ] `FRONTEND_ORIGINS` set to exact production domain(s) (not `*`)
- [ ] `UPLOAD_DIR` points to a persistent filesystem path
- [ ] CI pipeline green on target branch
- [ ] All 3 portals build without errors (`pnpm build`)
- [ ] `/health` returns `{status: ok, db: connected, claude: configured}`
- [ ] Resume file access tested end-to-end with auth
- [ ] Rate limiting tested (10 failed logins -> 429)
