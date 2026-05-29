# Stabilization Sprint — Summary

**Date:** 2026-05-28  
**Status:** Complete — all portals build, all 73 backend tests pass

---

## What Was Fixed

### Phase 1 — SSE Keepalive & Async Hardening

**Problem:** SSE stream had a 120-second queue timeout. Most reverse proxies (Nginx, Apache) close idle connections after 60–90 seconds, silently breaking active scoring sessions.

**Fix:** Reduced queue timeout to 25 seconds. On each timeout, the server now emits an SSE comment (`": keepalive\n\n"`) — the standard SSE keepalive mechanism. After 3 consecutive keepalives with no candidate progress, it also emits a user-visible "Still processing..." step event.

**Files:** `apps/backend/routers/scoring.py`

---

### Phase 1b — N+1 Query Elimination

**Problem:** Two N+1 query patterns:
1. `score_and_enqueue` (inside concurrent tasks) issued a separate `SELECT users WHERE id=?` per candidate
2. `get_rankings` issued separate `SELECT candidate_scores WHERE id=?` and `SELECT users WHERE id=?` per application row

**Fix:** Both replaced with bulk IN-clause preloads before the loop/task creation. For a job with 20 applications, this reduces DB round-trips from 41 to 3 (and from 40 to 3 inside the scoring stream).

**Files:** `apps/backend/routers/scoring.py`

---

### Phase 2 — Frontend Consolidation (packages/shared)

**Problem:** Three portals each had identical copies of:
- `isTokenExpired()` — JWT expiry utility (30-second buffer logic)
- `createApiClient` interceptors — proactive token expiry detection, guest-request 401 guard
- `useAuthStore` — Zustand auth store with BroadcastChannel logout sync

Any bug in these would need to be fixed in 3 places. This already caused drift in the previous sprint.

**Fix:** Moved all three into `packages/shared/`:
- `packages/shared/auth.ts` — `isTokenExpired()` + `AuthUser` type
- `packages/shared/apiClient.ts` — `createApiClient(baseURL)` factory
- `packages/shared/authStore.ts` — `useAuthStore` singleton

Each portal's `api/client.ts` reduced to 5 lines. Each portal's `store/auth.ts` reduced to 1 re-export line.

**Files:** `packages/shared/{auth,apiClient,authStore}.ts`, `packages/shared/index.ts`, `packages/shared/package.json`, all three portal `api/client.ts` and `store/auth.ts`

---

### Phase 3 — Backend Connectivity Detection

**Problem:** When the backend is unreachable, users saw blank screens or silent loading hangs. No user-facing signal that the API was down.

**Fix:** Added `BackendOfflineBanner` component to HR and applicant portals. Polls `/health` every 30 seconds (healthy) / 10 seconds (degraded). Displays a fixed-position warning banner when health check fails. Auto-dismisses when backend recovers.

**Files:** `apps/hr/src/components/BackendOfflineBanner.tsx`, `apps/applicant/src/components/BackendOfflineBanner.tsx`, both `App.tsx` files

---

### Phase 6 — Bundle Splitting

**Problem:** All portal JS was in one 300+ KB bundle. Vendor libraries (React, axios, Zustand) were re-downloaded on every app update even when unchanged.

**Fix:** Added `manualChunks` (function form, required by Vite 8's Rolldown bundler) to all three Vite configs, splitting into:
- `vendor-react` — react, react-dom, react-router-dom
- `vendor-query` — @tanstack/react-query
- `vendor-ui` — lucide-react
- `vendor-net` — axios, zustand

Result: main app chunk is now ~51–101 KB (down from 282–341 KB). Vendor chunks are separately cacheable.

**Files:** all three `vite.config.ts`

---

### Phase 7 — Test Suite Integrity

**Problem:** One integration test (`test_unauthenticated_hr_jobs_route_rejected`) targeted the dead `/jobs/hr/jobs` alias route removed in the previous sprint. Getting a 404 instead of 401/403 was causing a false-negative test failure.

**Fix:** Updated the test to verify auth protection on `/jobs/{id}/stream` instead. Removed the dead route from the `test_protected_routes_require_bearer_token` route list.

**Files:** `apps/backend/tests/test_integration.py`

---

## Impact

| Metric | Before | After |
|--------|--------|-------|
| Portal main bundle (HR) | ~341 KB | ~102 KB |
| Portal main bundle (Applicant) | ~282 KB | ~52 KB |
| SSE keepalive interval | 120s (proxy-unsafe) | 25s (proxy-safe) |
| Rankings DB queries (20 apps) | 41 | 3 |
| Scoring stream DB queries (20 apps) | 20 N+1 | 1 preload |
| Auth logic copies | 3 (one per portal) | 1 (packages/shared) |
| Test suite | 1 stale failure | 73/73 green |
