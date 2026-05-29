# File Changes — Stabilization Sprint

## Backend

| File | Change Type | Reason |
|------|-------------|--------|
| `apps/backend/routers/scoring.py` | Modified | SSE keepalive, N+1 fix in event_stream and get_rankings |
| `apps/backend/tests/test_integration.py` | Modified | Removed stale dead-route test, updated protected route list |

## packages/shared (new files)

| File | Change Type | Reason |
|------|-------------|--------|
| `packages/shared/auth.ts` | New | `isTokenExpired()` utility + `AuthUser` type — previously duplicated in all 3 portals |
| `packages/shared/apiClient.ts` | New | `createApiClient()` factory with interceptors — consolidated from all 3 portals |
| `packages/shared/authStore.ts` | New | `useAuthStore` Zustand store — consolidated from all 3 portals |
| `packages/shared/index.ts` | Modified | Added re-exports for the three new modules |
| `packages/shared/package.json` | Modified | Added `peerDependencies` for axios and zustand |

## HR Portal

| File | Change Type | Reason |
|------|-------------|--------|
| `apps/hr/src/api/client.ts` | Replaced | Now uses `createApiClient` from shared (5 lines vs 35) |
| `apps/hr/src/store/auth.ts` | Replaced | Now re-exports `useAuthStore` from shared (1 line) |
| `apps/hr/src/components/BackendOfflineBanner.tsx` | New | Health-polling connectivity banner |
| `apps/hr/src/App.tsx` | Modified | Added `BackendOfflineBanner` import and render |
| `apps/hr/vite.config.ts` | Modified | Added `manualChunks` for vendor bundle splitting |

## Applicant Portal

| File | Change Type | Reason |
|------|-------------|--------|
| `apps/applicant/src/api/client.ts` | Replaced | Now uses `createApiClient` from shared |
| `apps/applicant/src/store/auth.ts` | Replaced | Now re-exports `useAuthStore` from shared |
| `apps/applicant/src/components/BackendOfflineBanner.tsx` | New | Health-polling connectivity banner |
| `apps/applicant/src/App.tsx` | Modified | Added `BackendOfflineBanner` import and render |
| `apps/applicant/vite.config.ts` | Modified | Added `manualChunks` for vendor bundle splitting |

## Dev Portal

| File | Change Type | Reason |
|------|-------------|--------|
| `apps/dev/src/api/client.ts` | Replaced | Now uses `createApiClient` from shared |
| `apps/dev/src/store/auth.ts` | Replaced | Now re-exports `useAuthStore` from shared |
| `apps/dev/vite.config.ts` | Modified | Added `manualChunks` for vendor bundle splitting |

---

## Architectural Reasoning

**Why `peerDependencies` in shared, not `dependencies`?**  
All portals already install `axios` and `zustand` directly. Using `peerDependencies` tells pnpm to use the portal's own installed version rather than installing a second copy — prevents version drift and bundle duplication.

**Why function form for `manualChunks` (not object)?**  
Vite 8 uses Rolldown (Rust bundler) internally. Rolldown requires `manualChunks` to be a function. The object shorthand from Rollup v2 is not supported. Using `id.includes(...)` pattern-matching on the resolved module path is the idiomatic Rolldown approach.

**Why SSE comment keepalives (not data events)?**  
SSE spec defines `: comment` as a heartbeat mechanism. It is never dispatched to application code (`data:` prefix required for event dispatch), so it doesn't pollute the event stream. The bytes still reach the client's ReadableStream reader, resetting the heartbeat timer.
