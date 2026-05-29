# HR Portal Deep Scan

Runtime analysis of all HR portal pages — state management, API calls, SSE lifecycle,
React Query/Zustand interactions, and rendering bugs. Performed against the current
`feature/phase-6-agent-b` branch.

---

## Summary of Findings

| Severity | Count | Description |
|----------|-------|-------------|
| BUG (data loss / wrong data) | 3 | Rankings button disappears, stale job status after publish, Zustand verdict wipe |
| BUG (React rendering) | 1 | Campaign.tsx Fragment missing key |
| STALE (shared types) | 2 | `ApiProvider` excludes 'featherless'; `LogEventType` missing outbound events |
| RISK (UX confusion) | 3 | SSE no-clear on reconnect, RQ/Zustand desync on verdict change, ScoringStream double-POST in Strict Mode |
| MINOR | 3 | Candidates loaded for running campaigns, `navigate(-1)` type hack, missing applications invalidation after score reset |

---

## File-by-File Analysis

---

### 1. `pages/JobDetail.tsx`

#### BUG-1: "View Rankings" disappears after status transitions to interviewing/hired

**Location**: `JobDetail.tsx:337`
```tsx
{(job.status === 'closed' || job.status === 'sourcing') && scoringDone && (
  <button onClick={() => navigate(`/jobs/${id}/rankings`)}>View Rankings</button>
)}
```
Once HR clicks "Move to Interviewing" or "Mark as Hired", `job.status` transitions to
`'interviewing'` or `'hired'`. The View Rankings button is hidden and there is no other
navigation entry point to `/jobs/:id/rankings` from this page.

**Impact**: HR team can no longer review scored rankings after advancing the job lifecycle.
The scoring data is still in the DB but the button is gone.

**Fix**: Add the missing statuses to the condition:
```tsx
{['closed', 'sourcing', 'interviewing', 'hired'].includes(job.status) && scoringDone && (
```

#### MINOR-1: Applications list not invalidated after score reset

**Location**: `JobDetail.tsx:173-186` (`handleReopen`)
```tsx
await api.post(`/jobs/${id}/reopen`, { reset_scoring: resetScoring })
queryClient.invalidateQueries({ queryKey: ['job', id] })
queryClient.invalidateQueries({ queryKey: ['jobs'] })
```
When `reset_scoring: true`, the backend deletes all `CandidateScore` rows and sets
`application.rank = null`. The `['applications', id]` query cache is NOT invalidated.
The Applications table at the bottom of JobDetail will keep showing the old scored statuses
until React Query's background refetch (or window focus refetch) fires.

**Fix**: Add `queryClient.invalidateQueries({ queryKey: ['applications', id] })` to `handleReopen`.

#### NOTE: `canArchive` allows archiving from 'draft' status

**Location**: `JobDetail.tsx:239`
```tsx
const canArchive = !['active', 'archived'].includes(job.status)
```
A draft job that was never published can be archived. The backend guard in
`POST /jobs/{id}/archive` enforces its own rules — this is a frontend/backend alignment
question, not a bug, but worth verifying the guard matches intent.

---

### 2. `pages/WeightEditor.tsx`

#### BUG-2: No query invalidation after publish → stale job status on JobDetail

**Location**: `WeightEditor.tsx:108-123` (`handlePublish`)
```tsx
await api.post(`/jobs/${id}/publish`, { scoring_weights: weights })
showToast('Job published successfully!', 'success')
navigate(`/jobs/${id}`)
```
`POST /jobs/{id}/publish` transitions the job from `draft` → `active` on the server.
The navigate call renders `JobDetail` with the existing React Query cache, which still
holds `status: 'draft'`. There is no `queryClient.invalidateQueries` call before the navigate.

**Observed behavior**: JobDetail renders, shows "Draft" status badge briefly, then shows
the "Close Applications" button only after React Query performs its background stale refetch
(triggered by the default 0-second staleTime on focus events, so it may self-heal quickly,
but the flash of wrong state is visible).

**Fix**: Add before `navigate`:
```tsx
queryClient.invalidateQueries({ queryKey: ['job', id] })
```

---

### 3. `pages/Rankings.tsx` + `components/CandidatePanel.tsx`

#### RISK-1: Zustand / React Query desync on verdict change

**Architecture**: Rankings uses both React Query (`['applications', id]`) as server source
and Zustand (`useRankingsStore`) as the write-through layer:

```tsx
// Rankings.tsx:26-28
useEffect(() => {
  if (data) setCandidates(data)
}, [data, setCandidates])
```

When the user changes a verdict (Shortlist / Reject in CandidatePanel), the flow is:
1. `api.patch('/applications/{id}', { status, verdict })` → server updated
2. `onVerdictChange(appId, status, verdict)` → Zustand `updateCandidate` called
3. React Query `['applications', id]` cache NOT invalidated

**Problem**: On navigation away and back to Rankings, React Query refetches from server.
The `useEffect` that syncs `data → setCandidates` fires, overwriting the Zustand store with
the server response. Since the server was updated in step 1, this self-heals on refetch —
but until the refetch fires, the Zustand store is the only source and React Query cache
still holds the old verdict. Shortlist.tsx (which uses the same `['applications', id]` key)
will show the stale verdict until its own query refetches.

**Contrast with Shortlist.tsx**: `handleRemove` correctly does both:
```tsx
queryClient.setQueryData(...)         // optimistic local update
queryClient.invalidateQueries(...)    // force server refetch
```

**Fix for Rankings/CandidatePanel**: After `onVerdictChange`, also invalidate:
```tsx
queryClient.invalidateQueries({ queryKey: ['applications', application.job_id] })
```
(Requires passing `job_id` through the prop chain, which it already has on `Application`.)

#### BUG-3: `updateCandidate` with `candidate_scores: undefined` wipes scores

**Location**: `Rankings.tsx:63-68`
```tsx
const handleVerdictChange = (appId: string, status, verdict) => {
  updateCandidate(appId, {
    status,
    candidate_scores: selectedCandidate?.candidate_scores
      ? { ...selectedCandidate.candidate_scores, verdict }
      : undefined,    // ← THIS
  })
}
```

If `selectedCandidate.candidate_scores` is null/undefined, the patch spreads
`{ candidate_scores: undefined }` over the candidate in Zustand. JavaScript spread
with an explicit `undefined` value DOES overwrite the key:
```js
{ ...{ x: 1 }, x: undefined }  // → { x: undefined }
```

In practice this can't trigger from the Rankings UI because `filtered` only includes
candidates where `candidate_scores !== null`. But if this handler is ever called from
a different context (or the filter logic changes), it silently destroys score data.

**Fix**:
```tsx
...(selectedCandidate?.candidate_scores && {
  candidate_scores: { ...selectedCandidate.candidate_scores, verdict }
})
```

---

### 4. `hooks/useSSE.ts`

#### RISK-2: Events array not cleared on reconnect

**Location**: `useSSE.ts:43-48`
```tsx
const connect = useCallback(async (streamPath: string) => {
  // ...
  setEvents([])     // ← cleared only on fresh connect() call
  // ...
  const attemptConnect = async (): Promise<void> => {
    // ...
    } catch (err) {
      // reconnects via recursive attemptConnect() — setEvents([]) NOT called here
    }
  }
}, [resetHeartbeat])
```

On a network interruption mid-stream, `useSSE` reconnects by calling `attemptConnect`
recursively. The server re-sends the full event stream from position 0 (no resumption
protocol is implemented). The events array accumulates duplicate events.

**Impact on ScoringStream.tsx**: The `cardMap` deduplicated by `index` absorbs duplicates
correctly (last `candidate_done` event for an index wins). No visible data corruption.
The raw `events` array just grows larger than necessary.

**Impact severity**: Low — the deduplication in ScoringStream saves from visible bugs,
but memory grows proportionally to reconnect count × number of candidates.

#### NOTE: Heartbeat timeout is 150s (2.5 min)

`HEARTBEAT_TIMEOUT_MS = 150_000`. The backend sends keepalive comments every 25s.
With 10 candidates at 5 concurrent (max ~10–15s per candidate), a full session takes
roughly 20–40s. The 2.5 min timeout is generous and appropriate.

---

### 5. `pages/ScoringStream.tsx`

#### RISK-3: `POST /jobs/{id}/score` fires twice in React 18 Strict Mode (dev)

**Location**: `ScoringStream.tsx:37-64`
```tsx
useEffect(() => {
  // ...
  async function triggerScoring() {
    await api.post(`/jobs/${id}/score`)
    // ...
  }
  triggerScoring()
  return () => { cancelled = true }
}, [id])
```

React 18 Strict Mode mounts→unmounts→remounts every component in development. The
cleanup only sets `cancelled = true` (prevents setState after unmount) but does NOT
abort the in-flight `api.post`. The second mount fires a second POST.

**Impact**: The backend's `POST /jobs/{id}/score` is idempotent in effect (re-running
scoring is allowed) but the second call races with the first. In production (Strict Mode
disabled), this does not occur.

**Minor**: `navigate(jobNotClosed ? '/jobs/${id}' : -1 as unknown as string)` — the
`-1 as unknown as string` is a type cast to satisfy TypeScript while calling
`navigate(-1)`. This is valid React Router usage but the cast is fragile. The correct
signature is `navigate(-1)` directly (overload of `NavigateFunction`).

---

### 6. `pages/Outbound.tsx`

#### Analysis: Polling architecture is correct

The dual-interval pattern (progress spinner + campaign status polling) is implemented
correctly:
- Each `useEffect` captures `campaign.id` in closure and cleans up on return
- `pollingRef.current === intervalId` guard prevents double-cleanup on fast re-renders
- `setQueryData([updated, ...prev.slice(1)])` correctly updates only the most-recent
  campaign (index 0) without disturbing history (index 1+)
- On `status !== 'running'`, polling self-terminates and invalidates candidates query
- `candidate.status === 'complete'` gates the candidates query via `enabled`

#### MINOR-2: "Emails Ready" stat is misleading before send-all

**Location**: `Outbound.tsx:159`
```tsx
{totalContacted > 0 ? totalContacted : totalFound}
```
When campaign is `complete` but emails haven't been sent yet (`total_contacted = 0`),
the "Emails Ready" stat shows `totalFound` (e.g., "7"). The label "Emails Ready" is
accurate, but the number looks identical to "Developers Found" until the first send-all.
Users may think all emails were already sent.

**Fix**: Label it "Ready to Send" with value `totalFound`, and "Sent" with `totalContacted`
as a separate stat when `totalContacted > 0`.

#### NOTE: Rate-limit error message is GitHub-specific

**Location**: `Outbound.tsx:345-350`
```tsx
{isRateLimit && (
  <div>GitHub API rate limit reached. Please wait 60 seconds...</div>
)}
```
Rate limit detection checks `launchErrorMsg?.toLowerCase().includes('rate limit')`.
The backend 503 errors (Featherless not configured, no GitHub sourcing provider) will
show as generic errors because they don't contain "rate limit". This is correct behavior.

---

### 7. `pages/Campaign.tsx`

#### BUG-4: React Fragment missing `key` prop

**Location**: `Campaign.tsx:501-670`
```tsx
{filteredCandidates.map((candidate, i) => {
  return (
    <>                              {/* ← no key prop here */}
      <tr key={candidate.id}>...</tr>
      {isExpanded && (
        <tr key={`${candidate.id}-email`}>
          <ExpandedEmailRow ... />
        </tr>
      )}
    </>
  )
})}
```

React requires a `key` on the outermost element returned by a map callback. The `key`
on inner `<tr>` elements is irrelevant here — React uses the fragment's position index
for reconciliation, causing subtle row ordering bugs when `expandedRow` changes (React
may reuse wrong DOM nodes, causing flickering or incorrect email previews).

**Fix**:
```tsx
{filteredCandidates.map((candidate, i) => (
  <React.Fragment key={candidate.id}>
    <tr>...</tr>
    {isExpanded && <tr><ExpandedEmailRow ... /></tr>}
  </React.Fragment>
))}
```

#### MINOR-3: Candidates query runs even when campaign is not complete

**Location**: `Campaign.tsx:108-114`
```tsx
const { data: candidates = [] } = useQuery<OutboundCandidate[]>({
  queryKey: ['campaign-candidates', campaignId],
  queryFn: () => api.get(...).then(r => r.data),
  enabled: !!campaignId,   // ← no check on campaign.status
})
```
For a running or errored campaign, this fires `GET /api/campaigns/{id}/candidates`
and gets an empty array. Contrast with `Outbound.tsx` which guards with
`enabled: !!campaign?.id && campaign.status === 'complete'`.

Not a bug — the empty array renders an appropriate empty state — but the request is
unnecessary for non-complete campaigns.

---

### 8. `packages/shared/types.ts`

#### STALE-1: `ApiProvider` type excludes 'featherless'

**Location**: `types.ts:182`
```ts
export type ApiProvider = 'claude' | 'github'
```

All AI service logs now use `api_provider="featherless"` (fixed in this session for
`jd_analyzer.py`, `scorer.py`, `github_service.py`). The `SystemLog` interface has
`api_provider: ApiProvider`. The Dev portal log viewer will receive API responses with
`api_provider: "featherless"` that TypeScript considers invalid.

Runtime behavior: TypeScript errors at compile time, not at runtime. The Dev portal
log table renders the string regardless. But `tsc --noEmit` will fail if any code
does a type-checked comparison on this field.

**Fix**:
```ts
export type ApiProvider = 'featherless' | 'github'
```

#### STALE-2: `LogEventType` missing outbound event types

**Location**: `types.ts:174-179`
```ts
export type LogEventType =
  | 'jd_analysis'
  | 'candidate_scoring'
  | 'github_search'
  | 'profile_scoring'
  | 'outreach_generation'
  | 'feedback_generation'
```

The backend emits additional event types that are missing:
- `'outbound_signals'` — from `github_service.py` / `extract_github_signals()`
- `'outbound_profile_score'` — from `github_service.py` / `score_and_write_outreach()`

The system_logs table receives these values and the Dev portal log viewer uses
`LogEventType` for filtering. These events will either be silently excluded from
type-checked filters or cause TypeScript errors.

**Fix**: Add the missing types:
```ts
export type LogEventType =
  | 'jd_analysis'
  | 'candidate_scoring'
  | 'outbound_signals'
  | 'outbound_profile_score'
  | 'github_search'
  | 'profile_scoring'
  | 'outreach_generation'
  | 'feedback_generation'
```

---

## Prioritized Fix List

### Must Fix (data correctness)

1. **BUG-1** `JobDetail.tsx:337` — Add 'interviewing' and 'hired' to View Rankings condition
2. **BUG-2** `WeightEditor.tsx:121` — Add `queryClient.invalidateQueries` before navigate after publish
3. **BUG-3** `Rankings.tsx:63-68` — Guard `candidate_scores` patch to avoid undefined spread
4. **BUG-4** `Campaign.tsx:501` — Add `key` to React Fragment in candidate map

### Should Fix (stale types / TypeScript failures)

5. **STALE-1** `packages/shared/types.ts:182` — Add 'featherless' to `ApiProvider`
6. **STALE-2** `packages/shared/types.ts:174` — Add 'outbound_signals' and 'outbound_profile_score' to `LogEventType`

### Consider Fixing (UX / minor)

7. **RISK-1** Rankings + CandidatePanel — invalidate `['applications', id]` after verdict change
8. **MINOR-1** `JobDetail.tsx:180` — invalidate `['applications', id]` after reopen with reset_scoring
9. **MINOR-2** `Outbound.tsx:159` — split "Emails Ready" stat into "Ready" vs "Sent"
10. **MINOR-3** `Campaign.tsx:108` — gate candidates query on `campaign.status === 'complete'`

---

## SSE Lifecycle Diagram

```
ScoringStream mounts
  │
  ├── POST /jobs/{id}/score [triggerScoring]
  │     ├── 200 OK → setInitState('streaming') → ssePath = '/jobs/{id}/stream'
  │     ├── 400 → setJobNotClosed(true) → show error + navigate to job
  │     └── other → show error
  │
  └── useSSE(ssePath) [only when ssePath is set]
        │
        ├── connect('/jobs/{id}/stream')
        │     ├── setStatus('connecting'), setEvents([])
        │     └── attemptConnect()
        │           ├── fetch(BASE_URL + path, { headers: { Authorization: 'Bearer ...' } })
        │           ├── 200 → setStatus('streaming'), resetHeartbeat()
        │           │     ├── read chunks → parse 'data: {...}' lines
        │           │     │     ├── candidate_start → cardMap.set(index, {name, done:false})
        │           │     │     ├── candidate_done  → cardMap.set(index, {score, verdict, done:true})
        │           │     │     └── session_done    → setStatus('done'), ctrl.abort(), return
        │           │     └── stream ends without session_done → setStatus('done')
        │           └── network error → setStatus('error'), exponential backoff, retry
        │
        └── effect cleanup: ctrl.abort(), clearTimeout(heartbeat)
```

---

## React Query Key Map

| Key | Owner | Invalidated by |
|-----|-------|---------------|
| `['job', id]` | JobDetail, WeightEditor | handleCloseApplications, handleArchive, handleHire, handleReopen, handleMoveToInterviewing (**missing**: WeightEditor handlePublish) |
| `['jobs']` | Jobs list | handleArchive, handleHire, handleReopen, handleMoveToInterviewing |
| `['applications', id]` | JobDetail, Rankings, Shortlist | Shortlist handleRemove (**missing**: CandidatePanel verdict change, JobDetail reopen+resetScoring) |
| `['campaign-for-job', jobId]` | Outbound | launchCampaign onSuccess, polling setQueryData |
| `['campaign-candidates', campaignId]` | Outbound, Campaign | Outbound on poll complete, Campaign sendAll |
| `['campaign', campaignId]` | Campaign | not invalidated (Campaign is read-only view) |
