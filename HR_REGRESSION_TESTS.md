# HR Portal Regression Tests

No automated test runner is configured in this project (no Vitest/Jest setup).
This document covers two layers:

1. **Manual validation scripts** — step-by-step browser checks for each fixed issue
2. **Automated test stubs** — Vitest + React Testing Library code ready to add once
   a test runner is configured (`pnpm add -D vitest @testing-library/react @testing-library/user-event jsdom`)

---

## Manual Regression Scripts

Run these after every code change that touches HR portal pages.

---

### REGRESSION-1: Rankings button persists through all lifecycle stages

**Covers**: FIX-1

```
Precondition: A job with at least one scored candidate exists.

Steps:
1. Open /jobs/{id} — status = closed
   → EXPECT: "View Rankings" button visible

2. Click "Move to Interviewing"
   → EXPECT: status badge → "Interviewing"
   → EXPECT: "View Rankings" button still visible

3. Click "View Rankings"
   → EXPECT: Rankings page loads with scored candidates

4. Navigate back → Click "Mark as Hired"
   → EXPECT: status badge → "Hired"
   → EXPECT: "View Rankings" button still visible

5. Click "View Rankings"
   → EXPECT: Rankings page loads correctly

FAIL condition: "View Rankings" disappears in step 2 or 4.
```

---

### REGRESSION-2: Job status updates immediately after publish

**Covers**: FIX-2

```
Precondition: A job exists with status = draft.

Steps:
1. Navigate to /jobs/{id}/weights
2. Set weights (verify total = 100%)
3. Click "Publish Job"
4. Toast shows "Job published successfully!"
   → EXPECT: Navigate to /jobs/{id}
   → EXPECT: Status badge shows "Active" IMMEDIATELY
   → EXPECT: "Close Applications" button visible
   → EXPECT: NO "Draft" badge flicker

FAIL condition: Badge shows "Draft" for any duration after navigate.
```

---

### REGRESSION-3: Verdict change propagates to Shortlist without refresh

**Covers**: FIX-5, FIX-3

```
Precondition: Job with scored candidates. At least 2 shortlisted.

Steps:
1. Open /jobs/{id}/rankings
2. Click a candidate row to open CandidatePanel
3. Click "Reject" in the panel footer
4. Panel closes — candidate row verdict updates
5. WITHOUT refreshing, navigate to /jobs/{id}/shortlist
   → EXPECT: The rejected candidate is ABSENT from the shortlist
6. Navigate back to rankings
   → EXPECT: The candidate verdict still shows "Rejected"

FAIL condition: Candidate still appears in shortlist (step 5), or verdict
reverts to "Shortlisted" (step 6).
```

---

### REGRESSION-4: Campaign row expand/collapse is stable

**Covers**: FIX-4 (Fragment key)

```
Precondition: A completed campaign with 3+ candidates.

Steps:
1. Open /campaigns/{id}
2. Click "View Email" on candidate #1
   → EXPECT: Email row appears below candidate #1
   → EXPECT: Other candidate rows unchanged
3. Click "View Email" on candidate #3 (with candidate #1 still expanded)
   → EXPECT: candidate #3's email appears
   → EXPECT: candidate #1 email remains visible (or collapses depending on intended UX)
4. Click "Hide Email" on candidate #1
   → EXPECT: candidate #1 email collapses
   → EXPECT: candidate #3 row is unchanged

FAIL condition: Wrong email appears under wrong candidate; row flicker on collapse;
React console shows "Each child in a list should have a unique key" warning.
```

---

### REGRESSION-5: Rankings page shows scored data immediately after scoring

**Covers**: FIX-6

```
Precondition: Job with 3+ applicants, just closed, no scoring yet.

Steps:
1. Navigate to /jobs/{id}
2. Click "Close Applications" → enter cutoff → "Start Scoring"
3. Watch ScoringStream — wait for "session_done" summary panel
4. Click "View Full Rankings →"
   → EXPECT: Rankings page shows ALL scored candidates IMMEDIATELY
   → EXPECT: Score rings, verdicts, skill tags all populated
   → EXPECT: NO "No scored candidates" empty state

FAIL condition: Rankings page shows "No scored candidates, go score first"
empty state, requiring a manual refresh to see results.
```

---

### REGRESSION-6: SSE stream reconnects cleanly

**Covers**: FIX-11

```
Precondition: Job with 5+ candidates to score (gives time to interrupt).

Steps:
1. Start scoring stream on /jobs/{id}/scoring
2. Wait for 2-3 candidate_done events to appear
3. Open DevTools → Network tab → disable network (Offline mode)
4. Wait 5 seconds — EXPECT: "Connection lost. Reconnecting in 1s..." message
5. Re-enable network
   → EXPECT: Stream reconnects (status shows "Connecting to stream…")
   → EXPECT: Previously shown candidates reappear (server re-sends full stream)
   → EXPECT: NO duplicate candidate cards (same candidate appearing twice)
   → EXPECT: Scoring continues to completion

FAIL condition: Duplicate candidate rows appear after reconnect; or stream
permanently fails after one reconnect.
```

---

### REGRESSION-7: POST /score fires exactly once (Strict Mode)

**Covers**: FIX-10

```
Environment: Development mode only (React Strict Mode enabled).

Steps:
1. Open DevTools → Network tab → filter to "score"
2. Navigate to /jobs/{id}/scoring
   → EXPECT: Exactly ONE POST to /jobs/{id}/score in the network log
   → EXPECT: Exactly ONE "Initializing scoring session…" spinner

FAIL condition: Two POST requests appear in the network log;
OR two "Initializing scoring session…" spinners flash.

Note: Check DevTools → Console for any "Cannot update state on an unmounted
component" warnings, which would indicate the cancelled flag isn't working.
```

---

### REGRESSION-8: Job list refreshes after create/close/archive

**Covers**: FIX-7, FIX-8

```
Steps:
1. Open /jobs — note the current job count
2. Create a new job (complete the form + publish)
   → Navigate to weights → publish → navigate back to /jobs
   → EXPECT: New job appears IMMEDIATELY (no refresh needed)

3. Open an active job → Close Applications
   → Navigate back to /jobs
   → EXPECT: Job status shows "Closed" IMMEDIATELY

FAIL condition: New job absent, or old "Active" badge persists on the
list view after navigating back.
```

---

### REGRESSION-9: Score reset clears applications table

**Covers**: FIX-9

```
Precondition: Job with scored candidates (ranks + scores visible).

Steps:
1. Open /jobs/{id} — Applications table shows ranks and scored statuses
2. Click "Reopen" → check "Reset scoring data" → "Reopen as Draft"
   → EXPECT: Job status → "Draft"
   → EXPECT: Applications table below refreshes:
     - Status badges all show "pending" (or similar pre-score state)
     - No rank numbers visible

FAIL condition: Applications table still shows old scores/ranks after
reopen with reset_scoring = true.
```

---

## Automated Test Stubs (Vitest-ready)

These files are ready to run once Vitest is configured.
Add to `apps/hr/src/__tests__/`.

### Setup (if adding Vitest):
```bash
cd apps/hr
pnpm add -D vitest @testing-library/react @testing-library/user-event jsdom @vitejs/plugin-react
```

Add to `vite.config.ts`:
```ts
test: {
  globals: true,
  environment: 'jsdom',
  setupFiles: './src/__tests__/setup.ts',
}
```

---

### Test: Rankings button visibility across all lifecycle states

```typescript
// src/__tests__/JobDetail.lifecycle.test.tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import JobDetail from '../pages/JobDetail'

const STATUSES_WITH_RANKINGS = ['closed', 'sourcing', 'interviewing', 'hired']
const STATUSES_WITHOUT_RANKINGS = ['draft', 'active', 'archived']

function renderJobDetail(status: string, hasScoredApplicants = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  // Mock the two queries JobDetail uses
  qc.setQueryData(['job', 'job-1'], {
    id: 'job-1', title: 'Test Job', status, description: 'test', location: '',
    job_type: 'remote', application_deadline: null, shortlist_cutoff: null,
    scoring_weights: null, jd_parsed: null, created_at: new Date().toISOString(),
    closed_at: null, hired_at: null, hiring_summary: null,
  })
  qc.setQueryData(['applications', 'job-1'], hasScoredApplicants ? [
    { id: 'app-1', job_id: 'job-1', applicant_id: 'u1', applicant_name: 'Alice',
      resume_filename: 'cv.pdf', cover_note: '', status: 'shortlisted',
      rank: 1, submitted_at: new Date().toISOString(),
      candidate_scores: {
        id: 'cs-1', application_id: 'app-1', technical_score: 80, experience_score: 70,
        project_score: 75, education_score: 60, communication_score: 65,
        weighted_total: 73, verdict: 'shortlisted', reasoning: 'Good',
        strengths: [], gaps: [], matched_skills: [], missing_skills: [],
        interview_questions: [], applicant_feedback: '', scored_at: new Date().toISOString(),
      }
    }
  ] : [])

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/jobs/job-1']}>
        <Routes>
          <Route path="/jobs/:id" element={<JobDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('JobDetail — View Rankings button', () => {
  test.each(STATUSES_WITH_RANKINGS)(
    'shows "View Rankings" when status = %s and scoring is done',
    (status) => {
      renderJobDetail(status, true)
      expect(screen.getByRole('button', { name: /view rankings/i })).toBeInTheDocument()
    }
  )

  test.each(STATUSES_WITHOUT_RANKINGS)(
    'hides "View Rankings" when status = %s',
    (status) => {
      renderJobDetail(status, true)
      expect(screen.queryByRole('button', { name: /view rankings/i })).not.toBeInTheDocument()
    }
  )

  it('hides "View Rankings" when no scored candidates even if status = closed', () => {
    renderJobDetail('closed', false)
    expect(screen.queryByRole('button', { name: /view rankings/i })).not.toBeInTheDocument()
  })
})
```

---

### Test: Rankings verdict change invalidates cache

```typescript
// src/__tests__/Rankings.verdict.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import Rankings from '../pages/Rankings'
import * as client from '../api/client'

vi.mock('../api/client', () => ({ api: { get: vi.fn(), patch: vi.fn() } }))

it('invalidates applications cache after verdict change', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
  const mockApps = [/* … mock Application with candidate_scores … */]

  vi.mocked(client.api.get).mockResolvedValue({ data: mockApps })
  vi.mocked(client.api.patch).mockResolvedValue({ data: {} })

  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/jobs/job-1/rankings']}>
        <Routes>
          <Route path="/jobs/:id/rankings" element={<Rankings />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )

  // Click a candidate row to open panel
  await userEvent.click(await screen.findByText('Alice'))
  // Click Reject in panel footer
  await userEvent.click(screen.getByRole('button', { name: /reject/i }))

  await waitFor(() => {
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['applications', 'job-1'] })
    )
  })
})
```

---

### Test: WeightEditor invalidates after publish

```typescript
// src/__tests__/WeightEditor.publish.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import WeightEditor from '../pages/WeightEditor'
import * as client from '../api/client'

vi.mock('../api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

it('invalidates job queries after successful publish', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

  vi.mocked(client.api.get).mockResolvedValue({ data: {
    title: 'Test Job', scoring_weights: null,
    jd_parsed: { proposed_weights: { technical_skills: 40, experience: 25,
      projects: 20, education: 8, communication: 7 }, weight_reasoning: 'Because.' }
  }})
  vi.mocked(client.api.post).mockResolvedValue({ data: {} })

  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/jobs/job-1/weights']}>
        <Routes>
          <Route path="/jobs/:id/weights" element={<WeightEditor />} />
          <Route path="/jobs/:id" element={<div>JobDetail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )

  await userEvent.click(await screen.findByRole('button', { name: /publish job/i }))

  await waitFor(() => {
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['job', 'job-1'] })
    )
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['jobs'] })
    )
  })
})
```

---

### Test: ScoringStream abort on unmount (Strict Mode safety)

```typescript
// src/__tests__/ScoringStream.strictmode.test.tsx
import { render, unmount } from '@testing-library/react'
import { vi } from 'vitest'
import * as client from '../api/client'

vi.mock('../api/client', () => ({
  api: { post: vi.fn(() => new Promise(() => {})) }  // never resolves
}))

it('aborts POST /score when component unmounts', async () => {
  const postSpy = vi.mocked(client.api.post)
  const { unmount } = render(<ScoringStreamWrapped jobId="job-1" />)
  
  expect(postSpy).toHaveBeenCalledTimes(1)
  const callArgs = postSpy.mock.calls[0]
  const signal: AbortSignal = callArgs[2]?.signal
  
  expect(signal.aborted).toBe(false)
  unmount()
  expect(signal.aborted).toBe(true)
})
```

---

## Regression Gate: Required before merging to main

All 9 manual regression scripts must pass:

| # | Scenario | Status |
|---|----------|--------|
| 1 | Rankings button across lifecycle stages | |
| 2 | Job status immediate after publish | |
| 3 | Verdict change propagates to Shortlist | |
| 4 | Campaign row expand/collapse stable | |
| 5 | Rankings page loads scored data immediately | |
| 6 | SSE reconnect no duplicate events | |
| 7 | POST /score fires once (Strict Mode) | |
| 8 | Job list refresh after create/close | |
| 9 | Score reset clears applications table | |

Fill in "PASS" or "FAIL — [description]" for each before merge.
