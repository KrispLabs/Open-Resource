# HR Portal Remaining Risks

Architectural concerns not addressed in the stabilization phase.
These require conscious decisions about scope, testing infrastructure, or external dependencies.

---

## RISK-1: Zustand + React Query dual source-of-truth (Rankings)

**Severity**: Medium
**File**: `apps/hr/src/pages/Rankings.tsx`, `apps/hr/src/store/rankings.ts`

**Description**: Rankings uses BOTH React Query (`['applications', id]`) as server state
AND Zustand (`useRankingsStore`) as the writable layer for optimistic updates. The sync
is:
```tsx
useEffect(() => {
  if (data) setCandidates(data)    // RQ data overwrites Zustand on every re-fetch
}, [data, setCandidates])
```

**Risk**: Any background refetch of `['applications', id]` will overwrite pending
Zustand optimistic updates before the server response confirms them. This is mitigated
by the invalidation fix (FIX-5) — after a verdict change, the cache is immediately
invalidated and re-fetched from the server, so the Zustand state reflects the correct
server data within milliseconds.

**Residual exposure**: The window between `api.patch` completing and the invalidation
fetch completing is ~100-500ms. If the user triggers a second verdict change in this
window for a *different* candidate, the in-progress re-fetch could overwrite the second
change's optimistic update.

**Acceptable for demo**. For production: replace with a single source-of-truth using
React Query's `optimisticUpdate` pattern with rollback.

---

## RISK-2: Shortlist.tsx and CandidatePanel.tsx don't share invalidation

**Severity**: Low
**Files**: `apps/hr/src/pages/Shortlist.tsx`, `apps/hr/src/components/CandidatePanel.tsx`

**Description**: CandidatePanel is rendered in Rankings, not in Shortlist. If HR
navigates directly to `/shortlist/:id` without going through Rankings, there's no
CandidatePanel. The manual "Remove from shortlist" button in Shortlist correctly
invalidates `['applications', id]`. But there's no way to Shortlist a candidate from
the Shortlist page itself (re-adding a removed candidate requires going back to Rankings).

**Risk**: Not a bug — the intended UX is Rankings for verdict changes, Shortlist for
final review. But it could confuse HR users who expect to manage shortlists from the
Shortlist page.

---

## RISK-3: No per-route Error Boundaries

**Severity**: Low
**File**: `apps/hr/src/App.tsx`

**Description**: A single `<ErrorBoundary>` wraps the entire application. If any route's
render throws (e.g., an unhandled null access on a malformed API response), the ENTIRE
app crashes to the global error screen. Navigation, other tabs, all jobs — everything
is gone.

**Current state of the ErrorBoundary**:
```tsx
render() {
  if (this.state.hasError) return <CrashScreen />
  return this.props.children
}
```

No `componentDidCatch` logging, no per-route recovery.

**Fix**: Wrap each `<Route>` content in a `<RouteErrorBoundary>` that shows an inline
error with a retry button, without crashing the full app. React Router v6 also supports
`errorElement` per route for loader/action errors.

**Acceptable for demo** since API responses are well-typed. For production: per-route
boundaries with error logging (Sentry, etc.).

---

## RISK-4: SSE reconnect protocol is not position-aware

**Severity**: Medium — operational risk during slow networks
**File**: `apps/hr/src/hooks/useSSE.ts`

**Description**: The `useSSE` hook reconnects by re-connecting to the same SSE endpoint.
The backend has no concept of "resume from event X" — it always replays the full stream
from the beginning. This means:

1. The backend re-runs the *scoring event stream* (GET /jobs/{id}/stream), which reads
   already-scored candidates from the DB and re-emits their `candidate_done` events.
2. Any candidates scored DURING the network outage will also appear when the stream
   replays from the DB.

**Risk**: If the network drops during a long scoring session (10+ candidates), the
reconnect re-sends all events. With `setEvents([])` on reconnect (FIX-11), the UI
correctly processes them all again. But it means the client re-renders all candidate
cards as they "arrive" again — slightly jarring UX but functionally correct.

**Mitigation**: For scoring sessions with >5 candidates and an unreliable connection,
use `EventSource` with the `Last-Event-ID` header and add `id:` fields to SSE events
in the backend. This enables true resumption without full replay.

**Acceptable for demo**. For production environments with unreliable networks: implement
SSE event IDs.

---

## RISK-5: Campaign polling is not de-duplicated across tabs

**Severity**: Low
**File**: `apps/hr/src/pages/Outbound.tsx`

**Description**: The 3-second polling interval in `Outbound.tsx` uses a raw `setInterval`.
If the user opens `/jobs/{id}/outbound` in two browser tabs simultaneously, both tabs
poll the same campaign independently. This causes:
- 2× requests to `GET /api/campaigns/{id}` every 3 seconds
- No coordination between tabs — if one tab marks the campaign complete, the other
  doesn't know

**Risk**: At 2 tabs × 3s interval, the backend sees ~0.67 req/s for campaign status.
This is negligible. Multi-tab awareness is not a demo requirement.

**Acceptable**. For production: use React Query's built-in polling (`refetchInterval`)
instead of manual `setInterval`, and ensure `refetchOnWindowFocus: true` is set for
campaign queries. React Query deduplicated polling would consolidate the requests.

---

## RISK-6: No AI provider validation before scoring starts

**Severity**: Medium — operational risk when Featherless key is missing
**File**: `apps/hr/src/pages/ScoringStream.tsx`

**Description**: `POST /jobs/{id}/score` starts the scoring pipeline. If the Featherless
API key is missing (which is the current state until the user adds it), the backend starts
the SSE stream, attempts to score each candidate, and emits `candidate_done` events with
`score: 0` and `error: "Featherless API key not configured"`. The HR user sees a completed
stream with all candidates at score 0.

The campaign endpoint NOW returns 503 immediately when Featherless is not configured
(FIX from the AI debugging session). But the scoring stream endpoint does NOT have this
pre-flight guard — it only fails per-candidate during the stream.

**Visible symptom**: Scoring stream completes. Session summary says "0 shortlisted, N
rejected." Rankings shows all candidates at rank N with score 0. This looks like real
results, not a configuration error.

**Mitigation needed**: Add a pre-flight check in `POST /jobs/{id}/score` that returns
503 with a clear message if `featherless_api_key` is empty. The ScoringStream component
already handles HTTP errors from this endpoint (shows `initState === 'error'` with the
detail message).

**Backend change required**: `apps/backend/routers/scoring.py` — add key pre-flight.

---

## RISK-7: `staleTime: 30_000` is too long for live collaborative use

**Severity**: Low for single-HR demo; Medium for real deployment
**File**: `apps/hr/src/App.tsx`

**Description**:
```ts
defaultOptions: {
  queries: {
    staleTime: 30_000,        // 30 seconds
    refetchOnWindowFocus: false,
  }
}
```

If two HR users work on the same job (future multi-HR scenario), one user's changes
aren't visible to the other for up to 30 seconds. For a single-HR demo, this is
controlled by invalidation on every mutation — but the safety net requires every
mutation to call `invalidateQueries` correctly.

Every known mutation is now audited and covered (see HR_STABILIZATION_FIXES.md
mutation matrix). The 30s stale time is fine for the demo.

**For production with multiple HR users**: Reduce `staleTime` to 10-15s, or implement
WebSocket-based real-time sync.

---

## RISK-8: AI orchestration — campaign scoring skips candidates silently on JSON parse failure

**Severity**: Medium — operational AI quality
**File**: `apps/backend/services/github_service.py`

**Description**: `score_and_write_outreach()` retries once on `JSONDecodeError`. If
both attempts return malformed JSON from Featherless, the candidate is silently skipped.
The campaign `total_found` counter still includes the candidate, but no `OutboundCandidate`
row is created. HR sees "7 found" but only 5 candidate cards.

**Current mitigation**: `status="error"` is logged in `system_logs`. The Dev portal
log viewer can detect these. But the HR portal shows no indication that some candidates
were silently dropped.

**Fix**: Add a failed count to `OutboundCampaign` model (e.g., `total_failed: int`).
Surface it in the campaign stats row: "7 found · 5 scored · 2 skipped".

---

## RISK-9: Outbound "Emails Ready" stat is ambiguous (cosmetic, low priority)

**Severity**: Low
**File**: `apps/hr/src/pages/Outbound.tsx:159`

**Description**:
```tsx
{totalContacted > 0 ? totalContacted : totalFound}
```
The "Emails Ready" stat shows `totalFound` when no emails have been sent yet. This
implies all found candidates have ready emails, which is technically true (outreach_email
is generated during the campaign). But the label "Emails Ready" could be misread as
"emails already sent."

**Fix**: Rename to "Ready to Send" with `totalFound` value; show "Sent" with
`totalContacted` as a separate stat only when `totalContacted > 0`. Low priority since
the Send All button makes the intended action clear.

---

## Summary

| Risk | Severity | Action Required | Owner |
|------|----------|-----------------|-------|
| RISK-1: Zustand/RQ dual state | Medium | Accept for demo; fix for production | Agent B |
| RISK-2: Shortlist panel gaps | Low | Accept for demo | Agent B |
| RISK-3: Single Error Boundary | Low | Per-route boundaries for production | Agent B |
| RISK-4: SSE no position resumption | Medium | SSE event IDs for production | Agent A+B |
| RISK-5: Multi-tab polling | Low | Accept | — |
| RISK-6: No scoring pre-flight | **Medium** | Backend guard needed **now** | **Agent A** |
| RISK-7: staleTime for multi-user | Low | Accept for demo | — |
| RISK-8: Silent campaign failures | Medium | Add `total_failed` field | Agent A |
| RISK-9: Stat label ambiguity | Low | Cosmetic fix | Agent B |

**RISK-6 requires immediate action by Agent A** (backend): `POST /jobs/{id}/score`
should return 503 when Featherless API key is not configured, matching the same pattern
as `POST /api/jobs/{id}/campaigns`. Without this, HR users can run a scoring session
that silently produces all-zero results and look like real AI output.
