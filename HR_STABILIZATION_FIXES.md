# HR Portal Stabilization Fixes

All fixes applied in this stabilization phase. Ordered by priority tier.

---

## Phase 1 — Data Correctness

### FIX-1: Rankings button disappears after lifecycle transition
**File**: `apps/hr/src/pages/JobDetail.tsx:337`
**Root cause**: Condition `job.status === 'closed' || job.status === 'sourcing'` excluded
`interviewing` and `hired`. Once HR advanced the job lifecycle, the only path to scored
rankings was typing the URL manually.

**Before**:
```tsx
{(job.status === 'closed' || job.status === 'sourcing') && scoringDone && (
```
**After**:
```tsx
{job.status !== 'draft' && job.status !== 'active' && job.status !== 'archived' && scoringDone && (
```
Rankings button now visible in: `closed | sourcing | interviewing | hired`

---

### FIX-2: Stale job status badge after publish
**File**: `apps/hr/src/pages/WeightEditor.tsx:114-116`
**Root cause**: `POST /jobs/{id}/publish` transitions server state to `active`. The navigate
to JobDetail rendered from the stale React Query cache (`staleTime: 30s`,
`refetchOnWindowFocus: false`), showing "Draft" badge for up to 30 seconds.

**Before**: navigate immediately after API call, no cache invalidation.
**After**:
```tsx
await api.post(`/jobs/${id}/publish`, { scoring_weights: weights })
queryClient.invalidateQueries({ queryKey: ['job', id] })
queryClient.invalidateQueries({ queryKey: ['jobs'] })
navigate(`/jobs/${id}`)
```

---

### FIX-3: `candidate_scores: undefined` wipes stored scores in Zustand
**File**: `apps/hr/src/pages/Rankings.tsx:63-72`
**Root cause**: `{ candidate_scores: selectedCandidate?.candidate_scores ? {...} : undefined }`
— when spreading a patch with an explicit `undefined` value, JavaScript overwrites the
existing key. In practice this path required a scored candidate to have
`candidate_scores === null`, which the filtered list prevented, but the code was
structurally unsafe.

**Before**:
```tsx
updateCandidate(appId, {
  status,
  candidate_scores: selectedCandidate?.candidate_scores
    ? { ...selectedCandidate.candidate_scores, verdict }
    : undefined,
})
```
**After**:
```tsx
updateCandidate(appId, {
  status,
  ...(selectedCandidate?.candidate_scores && {
    candidate_scores: { ...selectedCandidate.candidate_scores, verdict },
  }),
})
```
`candidate_scores` is only spread into the patch when it is non-null, preventing
the undefined overwrite entirely.

---

### FIX-4: Campaign.tsx React Fragment missing key
**File**: `apps/hr/src/pages/Campaign.tsx:501`
**Root cause**: Map callback returned `<>` with no `key`. React used positional index
for reconciliation, causing DOM node reuse bugs when `expandedRow` toggled (wrong email
could appear in the wrong row, or rows flickered).

**Before**: `<>` (no key)
**After**: `<React.Fragment key={candidate.id}>`

Inner `<tr key={...}>` keys removed since `key` belongs on the outermost element per
React reconciliation rules.

---

## Phase 2 — State Synchronization

### FIX-5: Verdict change doesn't invalidate applications cache
**File**: `apps/hr/src/pages/Rankings.tsx:71-72`
**Root cause**: After Shortlist/Reject in CandidatePanel, only the Zustand store was
updated. The React Query `['applications', id]` cache stayed stale. Shortlist page
(same cache key) showed the old verdict. After navigating back to Rankings within the
30s stale window, the Zustand store was re-synced from stale cache data, reverting the
optimistic change.

**Fix**: Added `useQueryClient` to Rankings, invalidating after every verdict change:
```tsx
queryClient.invalidateQueries({ queryKey: ['applications', id] })
```

---

### FIX-6: ScoringStream navigates to Rankings with pre-scoring cache
**File**: `apps/hr/src/pages/ScoringStream.tsx:238-239`
**Root cause**: After scoring completes, "View Full Rankings" navigated to
`/jobs/${id}/rankings` which served the cached `['applications', id]` query — the same
data fetched when the job was first opened (before scoring ran). Rankings showed an empty
scored list with a "Go to Job" empty state for up to 30s.

**Fix**:
```tsx
onClick={() => {
  queryClient.invalidateQueries({ queryKey: ['applications', id] })
  navigate(`/jobs/${id}/rankings`)
}}
```

---

### FIX-7: Close job doesn't invalidate Jobs list
**File**: `apps/hr/src/pages/JobDetail.tsx:95-96`
**Root cause**: `POST /jobs/{id}/close` invalidated `['job', id]` (the detail view) but
not `['jobs']` (the list view). The Jobs list showed the job as "Active" for up to 30s.

**Fix**: Added `queryClient.invalidateQueries({ queryKey: ['jobs'] })` after close.

---

### FIX-8: Job creation doesn't invalidate Jobs list
**File**: `apps/hr/src/pages/JobCreate.tsx:61`
**Root cause**: After `POST /jobs`, the new job was not in the React Query cache. The
Jobs list showed the old list for up to 30s. If the user navigated back to the list
shortly after creation, they would not see the new job.

**Fix**: Added `queryClient.invalidateQueries({ queryKey: ['jobs'] })` immediately after
successful creation, before triggering analysis.

---

### FIX-9: Missing applications invalidation after reopen with score reset
**File**: `apps/hr/src/pages/JobDetail.tsx:179`
**Root cause**: `POST /jobs/{id}/reopen` with `reset_scoring: true` deletes all
`CandidateScore` rows and nulls out `application.rank` on the server. The
`['applications', id]` cache still held the scored data, so the Applications table
continued showing scores and ranks that no longer existed.

**Fix**: Conditional invalidation:
```tsx
if (resetScoring) queryClient.invalidateQueries({ queryKey: ['applications', id] })
```

---

## Phase 3 — React / Lifecycle Hardening

### FIX-10: POST /jobs/{id}/score fires twice in React 18 Strict Mode
**File**: `apps/hr/src/pages/ScoringStream.tsx:37-64`
**Root cause**: React 18 Strict Mode mounts → unmounts → remounts every component in
development. The cleanup set `cancelled = true` but did not abort the in-flight POST,
so both the first and second mount's requests reached the server.

**Fix**: Added `AbortController`:
```tsx
const ctrl = new AbortController()
await api.post(`/jobs/${id}/score`, undefined, { signal: ctrl.signal })
// cleanup:
return () => { cancelled = true; ctrl.abort() }
```
When Strict Mode unmounts the first instance, `ctrl.abort()` cancels the in-flight
request. The second mount starts a clean request. In production (no Strict Mode)
this has zero overhead.

---

### FIX-11: SSE reconnect accumulates duplicate events
**File**: `apps/hr/src/hooks/useSSE.ts:98-115`
**Root cause**: `connect()` calls `setEvents([])` at the top level, but reconnects
happen inside `attemptConnect()` recursively — skipping the event reset. The server
re-sends the full stream from position 0 on reconnect, producing duplicate events.
While ScoringStream's `cardMap` deduplicates by `index`, the raw `events` array grew
unboundedly across reconnects.

**Fix**: Added `setEvents([])` in the catch block before the reconnect delay:
```tsx
setEvents([])  // clear before reconnect — server re-sends full stream
await new Promise<void>(/* backoff delay */)
```

---

## Phase 4 — Type Contract Alignment

### FIX-12: `ApiProvider` type excluded 'featherless'
**File**: `packages/shared/types.ts:182`
**Before**: `export type ApiProvider = 'claude' | 'github'`
**After**: `export type ApiProvider = 'featherless' | 'github'`

All AI services now log `api_provider="featherless"`. The Dev portal log viewer type-
checks against `ApiProvider`, which was failing silently at the type level.

---

### FIX-13: `LogEventType` missing outbound event types
**File**: `packages/shared/types.ts:174`
Added `'outbound_signals'` and `'outbound_profile_score'` to `LogEventType`.
These are the event types emitted during outbound campaign execution — missing from
the type meant the Dev portal could not filter or display them correctly.

---

## Mutation → Invalidation Matrix (post-fix)

| Mutation | Invalidates | Status |
|----------|-------------|--------|
| POST /jobs (create) | `['jobs']` | ✓ Fixed |
| POST /jobs/{id}/analyze | — (job detail already cached as new) | ✓ OK |
| POST /jobs/{id}/publish | `['job', id]`, `['jobs']` | ✓ Fixed |
| POST /jobs/{id}/close | `['job', id]`, `['jobs']` | ✓ Fixed |
| PATCH /jobs/{id} (cutoff) | `['job', id]` | ✓ OK (cutoff not in list view) |
| POST /jobs/{id}/archive | `['job', id]`, `['jobs']` | ✓ OK |
| POST /jobs/{id}/hire | `['job', id]`, `['jobs']` | ✓ OK |
| POST /jobs/{id}/reopen | `['job', id]`, `['jobs']`, `['applications', id]` (conditional) | ✓ Fixed |
| POST /jobs/{id}/interviewing | `['job', id]`, `['jobs']` | ✓ OK |
| POST /jobs/{id}/score (trigger) | — (stream; invalidates `['applications', id]` on done) | ✓ Fixed |
| PATCH /applications/{id} (verdict) | `['applications', id]` (via Rankings) | ✓ Fixed |
| PATCH /applications/{id} (remove shortlist) | `['applications', id]` (Shortlist) | ✓ OK |
| POST /campaigns (launch) | `['campaign-for-job', jobId]` | ✓ OK |
| POST /campaigns/{id}/send-all | `['campaign-candidates', id]` | ✓ OK |

---

## Files Changed

| File | Changes |
|------|---------|
| `apps/hr/src/pages/JobDetail.tsx` | FIX-1 (rankings condition), FIX-7 (close invalidation), FIX-9 (reopen invalidation) |
| `apps/hr/src/pages/WeightEditor.tsx` | FIX-2 (publish invalidation) |
| `apps/hr/src/pages/Rankings.tsx` | FIX-3 (undefined spread guard), FIX-5 (verdict invalidation) |
| `apps/hr/src/pages/Campaign.tsx` | FIX-4 (Fragment key) |
| `apps/hr/src/pages/ScoringStream.tsx` | FIX-6 (session_done invalidation), FIX-10 (AbortController) |
| `apps/hr/src/pages/JobCreate.tsx` | FIX-8 (post-create invalidation) |
| `apps/hr/src/hooks/useSSE.ts` | FIX-11 (reconnect event clear) |
| `packages/shared/types.ts` | FIX-12 (ApiProvider), FIX-13 (LogEventType) |

All portals compile clean: `pnpm exec tsc --noEmit` → 0 errors on HR, applicant, and dev.
