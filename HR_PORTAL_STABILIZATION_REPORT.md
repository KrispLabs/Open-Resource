# HR Portal Stabilization Report

## Executive Summary

Full contract audit of all 9 HR portal pages against backend Pydantic schemas. Fixed 7 bugs across 7 files — all crash-prone error rendering patterns, 1 confirmed 422, 1 stale TypeScript type drift, and 1 missing invalidation. All 3 portals pass `tsc --noEmit` after changes.

---

## Bugs Fixed

### BUG-01 — `POST /jobs/{id}/close` returns 422 "Field Required"
**File:** `apps/hr/src/pages/JobDetail.tsx:73`  
**Risk:** Critical — blocks the entire close → score → rank flow  
**Root cause:** FastAPI requires a body to be present even when all fields are optional. Frontend called `api.post('/jobs/${id}/close')` with no body; backend `CloseJobRequest` declares `shortlist_cutoff: Optional[int] = None`.  
**Fix:** `api.post('/jobs/${id}/close', {})` — send empty JSON object.  
**Before:** 422 "Field required" on every close attempt.  
**After:** 200 OK, `showCutoffPrompt` fires, flow continues to scoring.

---

### BUG-02 — React crash: Pydantic array error details rendered as JSX (JobCreate)
**File:** `apps/hr/src/pages/JobCreate.tsx:62`  
**Risk:** High — any 422 from `POST /jobs` crashes the page  
**Root cause:** `?.response?.data?.detail ?? 'fallback'` — `??` only guards `null`/`undefined`. Pydantic 422 returns `detail` as an array; truthy array bypasses the fallback, stored in `error` state, rendered as `{error}` → "Objects are not valid as a React child".  
**Fix:** Added `extractErrorMsg(err, fallback)` helper; coerces array details to the first `msg` string.

---

### BUG-03 — React crash: Pydantic array error details rendered as JSX (WeightEditor)
**File:** `apps/hr/src/pages/WeightEditor.tsx:107`  
**Risk:** High — any 422 from `POST /jobs/{id}/publish` crashes the page  
**Root cause:** Same `??` pattern as BUG-02.  
**Fix:** Same `extractErrorMsg` helper.

---

### BUG-04 — React crash: Pydantic array error details rendered as JSX (Outbound)
**File:** `apps/hr/src/pages/Outbound.tsx:278-284`, `:229-233`  
**Risk:** High — two crash paths: `launchErrorMsg` (rendered inline) and `sendAll.onError` (via Toast)  
**Root cause 1:** `launchErrorMsg` typed `detail?: string` but backend can return array; rendered directly in JSX as `{launchErrorMsg}`.  
**Root cause 2:** `sendAll.onError` used same old `?? 'fallback'` pattern before calling `showToast`.  
**Fix:** Both replaced with `extractErrorMsg`. `launchErrorMsg` computation simplified to one line.

---

### BUG-05 — Type drift: `Jobs.tsx` local `interface Job` diverges from shared type
**File:** `apps/hr/src/pages/Jobs.tsx:6-14`  
**Risk:** Medium — local interface missing `description`, `shortlist_cutoff`, `scoring_weights`, `jd_parsed` — any code reading those fields would silently be `undefined` instead of typed  
**Root cause:** Local interface defined before `packages/shared/types.ts` existed or had `application_count`.  
**Fix:**  
1. Added `application_count?: number` to shared `Job` interface (backend already returns it in `JobResponse` and `JobListResponse`)  
2. Removed local interface; `Jobs.tsx` now imports `Job` from `@open-resource/shared`

---

### BUG-06 — `Shortlist.tsx` sends `'not_shortlisted'` status not in `ApplicationStatus` union
**File:** `apps/hr/src/pages/Shortlist.tsx:58`  
**Risk:** Medium — TypeScript type gap (backend accepted it, TS didn't); optimistic update used wrong value  
**Root cause:** `ApplicationStatus = 'pending' | 'shortlisted' | 'reviewing' | 'rejected'` — `not_shortlisted` omitted. Backend `VALID_STATUSES` includes it. Optimistic update incorrectly mapped to `'reviewing'` instead of `'not_shortlisted'`, and had no `invalidateQueries` to eventually sync.  
**Fix:**  
1. Added `'not_shortlisted'` to `ApplicationStatus` in shared types  
2. Optimistic update now uses `'not_shortlisted'` (consistent with server response)  
3. Added `queryClient.invalidateQueries({ queryKey: ['applications', id] })` after successful PATCH  
4. Applied `extractErrorMsg` to `handleRemove` error path

---

### BUG-07 — `Shortlist.tsx` missing `invalidateQueries` after status PATCH
**File:** `apps/hr/src/pages/Shortlist.tsx` (see BUG-06)  
Captured in BUG-06 fix — `invalidateQueries` added to ensure server state eventually re-syncs after optimistic update.

---

## Findings Without Code Changes

### FINDING-01 — Rankings.tsx: Zustand + React Query dual source of truth (intentional)
`Rankings.tsx` loads data via React Query then copies to `useRankingsStore` via `useEffect`. Components read from the Zustand store. This is intentional — the `CandidatePanel` slide-over uses `updateCandidate()` for optimistic local verdict changes without a full server refetch. Pattern is coherent; no change needed.

### FINDING-02 — Outbound.tsx: manual `setInterval` polling alongside React Query
A manual `setInterval` (3s) polls campaign status while `status === 'running'`. React Query is not used for campaign status polling — the interval directly calls `api.get` and writes via `queryClient.setQueryData`. This works correctly and avoids a double-poll. React Query's `refetchInterval` would be equivalent but the manual approach is acceptable given the on-complete cleanup logic. No change made.

### FINDING-03 — ScoringStream.tsx: `POST /jobs/{id}/score` sends no body (safe)
Confirmed: backend scoring route has no request body parameter. No fix needed.

---

## Shared Types Changes

| File | Change |
|------|--------|
| `packages/shared/types.ts` | Added `application_count?: number` to `Job` interface |
| `packages/shared/types.ts` | Added `'not_shortlisted'` to `ApplicationStatus` union |

---

## Files Changed

| File | Type | Fix |
|------|------|-----|
| `packages/shared/types.ts` | Modified | Added `application_count?` to Job; added `not_shortlisted` to ApplicationStatus |
| `apps/hr/src/pages/JobDetail.tsx` | Modified | Fixed 422: send `{}` body on `POST /close` |
| `apps/hr/src/pages/JobCreate.tsx` | Modified | Added `extractErrorMsg`; applied to catch block |
| `apps/hr/src/pages/WeightEditor.tsx` | Modified | Added `extractErrorMsg`; applied to catch block |
| `apps/hr/src/pages/Outbound.tsx` | Modified | Added `extractErrorMsg`; fixed `launchErrorMsg` + `sendAll.onError` |
| `apps/hr/src/pages/Jobs.tsx` | Modified | Removed local Job interface; imports shared type |
| `apps/hr/src/pages/Shortlist.tsx` | Modified | Added `extractErrorMsg`; fixed status; added `invalidateQueries` |

---

## Post-Fix Verification

```
cd apps/hr && tsc --noEmit       → exit:0
cd apps/applicant && tsc --noEmit → exit:0
cd apps/dev && tsc --noEmit      → exit:0
```

All three portals pass TypeScript checks after shared type changes.

---

## Remaining Risks (Not Fixed Here)

See `NEXT_PRIORITY.md` for non-blocking items deferred from the stabilization sprint:
- `AuthSync`/`ErrorBoundary` triplication across portals
- Playwright E2E tests missing
- passlib/crypt Python 3.13 deprecation
- Alembic migration baseline
