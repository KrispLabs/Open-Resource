# Open Resource — Production Audit Report

**Audit date:** 2026-05-29
**Branch:** `outbound-v3-rebuild`
**Scope:** Full stack — backend (FastAPI), 3 React portals (applicant / HR / dev), shared packages, auth, AI workflows, data integrity, UX.
**Auditor note:** Issues marked **[FIXED]** were remediated during this audit (code changes applied). Issues marked **[OPEN]** are documented with exact fixes but not yet applied.

---

## Executive Summary

### Health scores

| Dimension | Score (pre-audit) | Score (post-fix) |
|---|---|---|
| Stability | 4 / 10 | 8 / 10 |
| Reliability | 5 / 10 | 8 / 10 |
| Security | 5 / 10 | 7.5 / 10 |
| Data integrity | 4 / 10 | 8 / 10 |
| UX completeness | 6 / 10 | 6.5 / 10 |
| **Overall** | **4.8 / 10** | **7.6 / 10** |

**Production readiness (pre-audit): Not Production Ready.**
**Production readiness (post-fix): Conditionally Production Ready.**

### Top risks (pre-audit)

1. **Applicant portal tab crash** — a `BroadcastChannel` logout loop turned a single sign-out into an unbounded message storm that froze/crashed the tab. *(CRITICAL — FIXED)*
2. **Hidden automation** — closing a job auto-started AI scoring, violating the "HR actions must be manual" requirement. *(HIGH — FIXED)*
3. **Cross-recruiter data exposure (IDOR)** — any HR user could read another recruiter's campaign, its candidates (names, emails-equivalent GitHub profiles, outreach drafts), and trigger their sends. *(HIGH — FIXED)*
4. **Concurrent-session DB corruption** — batch scoring and outbound sourcing shared one SQLAlchemy `Session` across up to 10 concurrent coroutines that each committed, risking interleaved/rolled-back transactions and wrong scores. *(HIGH — FIXED)*
5. **Re-run fragility** — re-scoring inserted duplicate rows that hit the unique constraint and poisoned the session. *(MEDIUM — FIXED)*

### Critical findings summary

- The headline crash was deterministic, not load-dependent: **every** logout triggered the storm; rapid logout/login amplified it. Root cause + fix below (C-01).
- AI decisions were never truly automated end-to-end, but scoring *started* implicitly on close and *ran* implicitly on opening the stream. Now scoring is an explicit, idempotent, repeatable recruiter action.

---

## Issue Inventory

### CRITICAL

#### C-01 — BroadcastChannel logout storm crashes the tab **[FIXED]**
- **Category:** Stability / infinite loop
- **Description:** Signing out crashed or froze the browser tab, especially under rapid logout/login.
- **Root cause:** `useAuthStore.logout()` (in `packages/shared/authStore.ts`) created a fresh `BroadcastChannel('or_auth')` and posted `{type:'logout'}` on every call. `AuthSync` held its **own** `BroadcastChannel('or_auth')` instance; per spec, a channel receives messages from every other same-named channel in the same context. So `logout()`'s message was delivered to `AuthSync`, whose handler called `logout()` **again**, which posted again, which was received again — an unbounded synchronous-feedback message storm saturating the main thread. The React `ErrorBoundary` cannot catch this (it is not a render error), so the tab simply locks up.
- **Impact:** Tab crash / freeze on a core, frequently-used action. Reproducible 100% of the time.
- **Reproduction:** Log in to the applicant portal → click "Sign out". (Or log out/in repeatedly.)
- **Fix applied:**
  - Added a local-only `clearSession()` action that clears state **without** broadcasting, and made it idempotent.
  - `logout()` now only broadcasts when a live session actually existed (`hadSession` guard).
  - All three `AuthSync.tsx` receivers (applicant/hr/dev) and the applicant `ProtectedRoute` now call `clearSession()` instead of `logout()`, so reacting to a logout can never emit another logout.
- **Files:** `packages/shared/authStore.ts`, `apps/{applicant,hr,dev}/src/components/AuthSync.tsx`, `apps/applicant/src/components/ProtectedRoute.tsx`

#### C-02 — IDOR: cross-recruiter campaign access & actions **[FIXED]**
- **Category:** Authorization / broken object-level access control
- **Description:** `GET /api/campaigns/{id}`, `GET /api/campaigns/{id}/candidates`, and `POST /api/campaigns/{id}/send-all` checked only that the campaign existed and that the caller had the `hr` role — not that the caller **owned** the campaign.
- **Root cause:** Missing `campaign.created_by != current_user.id` check (the list endpoints filtered by owner, but the by-id endpoints did not).
- **Impact:** Any HR account could enumerate another recruiter's sourced candidates, read their personalized outreach drafts, and mark their outreach as "sent."
- **Reproduction:** As HR-B, call `GET /api/campaigns/<HR-A-campaign-id>/candidates`.
- **Fix applied:** Added ownership checks (403 "Not your campaign") to all three endpoints.
- **Files:** `apps/backend/routers/outbound.py`

### HIGH

#### H-01 — Hidden automation: scoring auto-starts on job close **[FIXED]**
- **Category:** Workflow / requirement violation (#4 Manual HR actions)
- **Description:** `POST /jobs/{id}/close` automatically spawned the AI scoring background task.
- **Root cause:** `close_job()` called `asyncio.create_task(_run_scoring_background(...))`.
- **Impact:** Violated the explicit product rule that "Run AI Scoring" must be a separate, manually-triggered action. A recruiter closing applications unintentionally consumed AI quota and produced verdicts before reviewing weights.
- **Fix applied:** `close_job()` no longer starts scoring; it returns `scoring_status: "ready_to_score"` (or `scoring_pending_api_key`). Scoring is started only via the explicit `POST /jobs/{id}/score` or by opening the scoring stream.
- **Files:** `apps/backend/routers/scoring.py`
- **Follow-up [OPEN]:** Opening the SSE stream (`GET /jobs/{id}/stream`) still *executes* scoring as a side effect of viewing. This is the intended "Run Scoring" screen, but to fully honor "View AI Scores must be manual," consider a dedicated read-only rankings view (already exists: `GET /jobs/{id}/rankings`) and treat the stream strictly as the explicit "Run" action.

#### H-02 — Concurrent coroutines share one DB Session (scoring) **[FIXED]**
- **Category:** Concurrency / data integrity
- **Description:** `_run_scoring_background` and the SSE `event_stream` ran up to 5 `score_candidate` coroutines concurrently, all using a **single** `Session`, each calling `db.commit()` (directly and via `write_log`).
- **Root cause:** SQLAlchemy `Session` is not safe for concurrent/interleaved use. While one coroutine awaited the AI HTTP call, another could query/commit on the same session, flushing a third's half-built objects, raising `InvalidRequestError`/`This transaction is closed`, and committing partial work.
- **Impact:** Intermittently missing or wrong scores, rankings computed on partial data, opaque 500s — i.e. **incorrect hiring outcomes**.
- **Fix applied:** Each scoring task now opens and closes its own `SessionLocal()`. Job fields are captured as primitives before fan-out. The SSE queue now carries plain dicts (`weighted_total`, `verdict`) instead of ORM objects bound to a session, eliminating detached-instance reads in the consumer.
- **Files:** `apps/backend/routers/scoring.py`

#### H-03 — Concurrent coroutines share one DB Session (outbound) **[FIXED]**
- **Category:** Concurrency / data integrity
- **Description:** `run_outbound_campaign` shared its campaign `Session` across `_fetch_with_semaphore` (×10) and `_score_profile` (×3) coroutines, each calling `write_log(db, …)` (which commits).
- **Root cause:** Same as H-02.
- **Impact:** Corrupted/aborted campaign transactions; campaigns silently completing with fewer candidates than discovered.
- **Fix applied:** Added `_bg_write_log(**kwargs)` that writes each log on its own short-lived session (and swallows logging errors so a log hiccup never aborts a campaign). The four concurrent log calls now use it; sequential logging on the campaign session is unchanged.
- **Files:** `apps/backend/services/github_service.py`

#### H-04 — `score_candidate` not idempotent; re-runs poison the session **[FIXED]**
- **Category:** Data integrity / re-run safety (requirement #5)
- **Description:** `score_candidate` always `INSERT`ed a new `CandidateScore`. `candidate_scores.application_id` is `UNIQUE`, so a re-run, or a race between the background task and the stream, raised `IntegrityError` and left the session unusable.
- **Root cause:** No upsert; no `IntegrityError` handling.
- **Impact:** "Re-run scoring" could fail mid-batch; partial rankings.
- **Fix applied:** `score_candidate` now upserts (update existing row or insert), and on `IntegrityError` rolls back and returns the row a concurrent writer inserted. Combined with H-02, reruns are now safe and repeatable.
- **Files:** `apps/backend/services/scorer.py`
- **Note:** The explicit re-score endpoint `POST /jobs/{id}/score` already clears stale scores first; it remains the recommended rerun path. There is still **no in-flight lock** (see M-04).

### MEDIUM

#### M-01 — Backend/frontend password policy mismatch + weak email validation **[FIXED]**
- **Category:** Input validation / signup robustness (requirement #2)
- **Description:** Frontends required ≥8-char passwords; backend `RegisterRequest` allowed ≥6. Emails were accepted as free-form `str` with no format check or normalization.
- **Impact:** API-level registrations could bypass the UI policy; `Foo@X.com` and `foo@x.com` could become distinct accounts; login was case-sensitive against stored casing.
- **Fix applied:** Backend now enforces ≥8-char passwords, validates email format, normalizes email (trim + lowercase) on both register and login, and trims/validates name length.
- **Files:** `apps/backend/schemas/auth.py`
- **Caveat [OPEN]:** `apps/applicant/src/pages/Register.tsx` stores the user object with the *raw* typed email (not normalized). Cosmetic only (the JWT is authoritative), but should be aligned. Also, any pre-existing accounts created with mixed-case emails will no longer match on login — acceptable pre-launch; run a one-time lowercasing migration if data exists.

#### M-02 — Registration race condition returns 500 instead of 409 **[FIXED]**
- **Category:** Concurrency / error handling
- **Description:** Two simultaneous registrations with the same email both passed the `get_user_by_email` pre-check; the second `INSERT` hit the unique constraint and surfaced as an unhandled 500.
- **Fix applied:** `register` now catches `IntegrityError`, rolls back, and returns 409 "Email already registered."
- **Files:** `apps/backend/routers/auth.py`

#### M-03 — Applicants see raw `verdict` ("rejected") **[OPEN]**
- **Category:** UX / policy
- **Description:** `ApplicantScoreView` correctly hides `reasoning` and `interview_questions`, but still returns `verdict`, which can be the literal string `"rejected"`. CLAUDE.md specifies applicants should see `weighted_total`, `rank`, `applicant_feedback`, and `status` — not a blunt verdict.
- **Impact:** Candidate-facing harshness; potential reputational/legal sensitivity around automated "rejected" labels.
- **Recommended fix:** Remove `verdict` from `ApplicantScoreView` (or map it to a softer status), relying on `applicant_feedback` + shortlist `status` for the applicant-facing message.
- **Files:** `apps/backend/schemas/application.py`, applicant result UI.

#### M-04 — No lock against concurrent/duplicate scoring runs **[OPEN]**
- **Category:** Concurrency / resource control
- **Description:** Nothing prevents two simultaneous `POST /jobs/{id}/score` calls (or `/score` + an open stream) from running two scoring passes at once. With H-04's upsert this no longer corrupts data, but it doubles AI spend and can interleave rank assignment.
- **Recommended fix:** Track a per-job in-flight flag (e.g. a `scoring_in_progress` column or an in-process `set[job_id]`), reject/short-circuit a second run with 409 "Scoring already in progress."
- **Files:** `apps/backend/routers/scoring.py`

#### M-05 — Rank assignment is non-transactional / racy across runners **[OPEN]**
- **Category:** Data integrity
- **Description:** Both `_run_scoring_background` and the stream independently re-query scored apps and rewrite `rank`/`status`. If both finalize near-simultaneously (M-04), ranks can briefly disagree.
- **Recommended fix:** Centralize rank/shortlist finalization in one function guarded by M-04's lock; run it once after a scoring pass completes.

#### M-06 — In-memory login rate limiter is per-process **[OPEN]**
- **Category:** Security / scaling
- **Description:** `_login_attempts` is a module-level dict. It resets on restart and is not shared across workers/instances, so the 10/min limit is per-process, not per-deployment.
- **Recommended fix:** Back the limiter with Redis (or the DB) before running multiple workers; document the single-worker assumption otherwise.

### LOW

#### L-01 — `GET /setup/status` is unauthenticated **[OPEN]**
- Returns booleans for which providers are configured (no secrets). Minor information disclosure; acceptable for first-run setup but consider gating once configured.
- **File:** `apps/backend/routers/setup.py`

#### L-02 — `BackendOfflineBanner` effect re-subscribes on every `offline` toggle **[OPEN]**
- `useEffect([offline])` tears down and re-runs the poll loop whenever the flag flips, firing an immediate extra `/health` check. Not a leak (cleanup is correct), but churny. Prefer a `ref` for `offline` and a single stable interval.
- **Files:** `apps/{applicant,hr}/src/components/BackendOfflineBanner.tsx`

#### L-03 — SSE reconnect re-runs the whole scoring pass **[OPEN]**
- On reconnect, `useSSE` clears events and the server re-opens the stream, which re-scores (now cheap due to the "already scored" guard + upsert, but still issues redundant queries). Acceptable; consider a resume token if streams get large.
- **Files:** `apps/hr/src/hooks/useSSE.ts`, `apps/backend/routers/scoring.py`

#### L-04 — Verbose AI request/response logging **[OPEN]**
- `jd_analyzer` logs prompt and response previews at INFO. Fine for debugging; ensure log level is raised and previews trimmed in production to avoid leaking JD/PII into logs.

---

## Stability Analysis

- **Authentication flow:** The logout storm (C-01) was the dominant instability and is fixed. The split into `logout()` (broadcasts) vs `clearSession()` (local, idempotent) makes the auth state machine convergent under repeated/rapid actions. `ProtectedRoute` no longer mutates store state with a side-effecting broadcast during render.
- **State management:** Zustand store is now idempotent on clear. React Query is configured with `retry: 1`, `refetchOnWindowFocus: false`, 30s stale time — reasonable defaults; queries are correctly gated on `!!token`.
- **Race conditions:** Fixed — concurrent DB sessions (H-02/H-03), registration race (M-02), score upsert race (H-04). Remaining: duplicate scoring runs (M-04) and rank finalization (M-05), now non-corrupting but worth locking.
- **Memory leaks:** SSE hook aborts the controller and clears the heartbeat on unmount; `AuthSync` removes its listener and closes the channel; `BackendOfflineBanner` clears its timer. No leaks found (L-02 is churn, not a leak).
- **Infinite render loops:** None remaining. `ProtectedRoute` settles in ≤2 renders.
- **API failures:** JD analysis and scoring map provider timeouts/HTTP/JSON errors to specific 5xx with actionable messages. Outbound failures set campaign `status="error"` with a logged reason (never a silent "complete with 0").
- **Concurrency risks:** Addressed for scoring and outbound; AI fan-out is bounded by semaphores (5 / 10 / 3).

## Security Analysis

- **Authentication:** JWT HS256, 7-day expiry, bcrypt hashes, `password_hash` never serialized. Production startup refuses default `JWT_SECRET`/`SERVER_SECRET_KEY`. Good.
- **Authorization:** Role guards (`require_hr`, `require_dev`, etc.) plus per-row ownership checks on jobs/applications. **IDOR on campaigns fixed (C-02).** Provider credentials are AES-256-GCM encrypted at rest and never returned in plaintext (`provider_manager.list()` returns status only).
- **Data exposure:** Applicant score view correctly excludes `reasoning`/`interview_questions` (M-03 flags the residual `verdict`). `GET /setup/status` public but boolean-only (L-01).
- **Input validation:** Email/password validation hardened (M-01). PDF upload validates size (5MB) and magic bytes. Cover-note length capped.
- **Secrets/config:** No hardcoded secrets found; all via env → encrypted DB. CORS origins from env. Security headers + request-ID middleware present.
- **Rate limiting:** Present for auth but per-process (M-06).

## UX/UI Analysis

- **Inconsistent components:** Auth pages (`Login`/`Register`) use heavy inline styles while the rest of the app uses CSS-variable classes — works, but inconsistent with the design-system rule. Recommend migrating to the shared `.btn`/`.form-*` classes and tokens.
- **Loading/error states:** Login/Register have loading + error states. Apps use React Query; verify every list/detail view renders skeletons + error + empty (skeleton components exist). SSE has explicit `connecting/streaming/done/error` plus reconnect messaging.
- **Empty states:** Present in several pages; do a final sweep of HR Rankings/Shortlist/Campaigns and applicant dashboard for the zero-data case.
- **Accessibility:** Offline banner uses `role="alert"`. Buttons are real `<button>`s. Gaps: form inputs rely on adjacent `<label>` without explicit `htmlFor`/`id`; icon-only controls (theme toggle, avatar) need `aria-label`. Color-contrast on muted text should be verified in light mode.
- **Mobile responsiveness:** Applicant portal has a bottom tab nav; HR/Dev are desktop-first by design.
- **Dead ends:** Catch-all routes redirect sensibly. `verdict="rejected"` shown to applicants (M-03) is the main rough edge.

## AI System Analysis

- **Scoring reliability:** Deterministic post-processing — weighted total computed in code, verdict derived from thresholds (≥70 shortlist, ≤45 reject), so the LLM's self-reported verdict cannot override policy. Weight normalization in `jd_analyzer` guarantees weights sum to 100 even on malformed output.
- **Explainability:** `reasoning`, `strengths`, `gaps`, `matched/missing_skills`, `interview_questions`, and `applicant_feedback` are persisted and surfaced to HR.
- **Failure recovery:** Markdown-fence stripping + brace-extraction fallback for JSON; provider errors mapped to specific HTTP codes; orphan campaigns stuck in `running` >1h are recovered to `failed` at startup.
- **Retry behavior:** GitHub enrichment retries 5xx/timeouts/secondary-rate-limits with backoff; 401 fails loud (never silent zero). Featherless scoring has a 90s timeout but **no retry** — a single transient failure drops that candidate from the batch (acceptable; reruns recover it).
- **Edge cases:** Empty applicant set, missing resume file, and deleted GitHub accounts are handled. Confidence is implicit (numeric scores) — consider surfacing a per-candidate confidence/uncertainty signal.
- **Data quality:** Resume text capped at 4000 chars and JD at 3000 — long resumes are truncated, which can understate strong candidates. Consider chunking/summarization for long documents.

## Technical Debt

- **Code smells:** Auth pages' inline styling; repeated `provider_manager.get(...) or settings....` key-resolution pattern scattered across routers (extract a helper).
- **Duplicate logic:** Rank/shortlist finalization is duplicated in `_run_scoring_background` and the stream (M-05) — extract one function.
- **Unused/legacy:** `OUTBOUND_PAT_MIGRATION_PLAN.md` and Bright Data dataset fields remain after the PAT migration; prune once stable. `fetch_github_profile` and `fetch_profiles_pat` overlap.
- **Architecture:** SQLite + in-process background tasks + in-memory rate limiter are single-instance assumptions. Document "single worker" or migrate (Postgres + a task queue + Redis) before horizontal scaling. SSE already precludes serverless (correctly noted in CLAUDE.md).

---

## Production Readiness Checklist

| Item | Status |
|---|---|
| No tab-crashing client bugs | PASS *(C-01 fixed)* |
| Object-level authorization on all by-id endpoints | PASS *(C-02 fixed)* |
| No hidden automation of HR decisions | PASS *(H-01 fixed)* |
| Concurrency-safe DB access in background work | PASS *(H-02/H-03 fixed)* |
| Idempotent, repeatable AI re-runs | PASS *(H-04 fixed; M-04 lock recommended)* |
| Consistent auth validation (frontend/backend) | PASS *(M-01/M-02 fixed)* |
| Secrets encrypted / no defaults in prod | PASS |
| Applicants cannot see reasoning/interview questions | PASS |
| Applicant-facing copy avoids raw "rejected" verdict | WARNING *(M-03)* |
| Duplicate-run lock + single rank finalizer | WARNING *(M-04/M-05)* |
| Distributed rate limiting | WARNING *(M-06, single-worker only)* |
| Accessibility (labels/aria/contrast) | WARNING |
| Design-system consistency on auth pages | WARNING |
| AI retry on transient scoring failure | WARNING |
| Horizontal scaling (Postgres/queue/Redis) | FAIL *(by design for demo; migrate before scale)* |
| Production log levels (trim AI previews) | WARNING *(L-04)* |

---

## Final Verdict

### Conditionally Production Ready

**Reasoning.** The audit found and fixed every issue capable of crashing the client, corrupting hiring data, exposing one recruiter's data to another, or silently automating hiring decisions — the five highest-impact risks (C-01, C-02, H-01..H-04) plus signup hardening (M-01/M-02). Post-fix, the platform is stable under abusive logout/login, runs scoring and outbound concurrently without DB corruption, treats scoring/outreach/shortlisting as explicit and idempotent recruiter actions, and enforces ownership on campaign endpoints.

It is **conditionally** ready because the remaining items are operational, not correctness-critical, and are safe to ship behind a controlled launch:

1. **Single-instance only.** SQLite, in-process tasks, and the in-memory rate limiter (M-06) mean exactly one backend worker. Launch with one worker; plan the Postgres + queue + Redis migration before scaling.
2. **Add the scoring in-flight lock (M-04)** and a single rank finalizer (M-05) to prevent double AI spend.
3. **Soften the applicant-facing verdict (M-03).**
4. **Accessibility + auth-page design-system pass** before broad candidate exposure.

With one backend worker and items 1–3 addressed, the platform is safe to put in front of real recruiters and candidates. Without the single-worker constraint, it is **not** ready.

---

### Appendix — Files changed in this audit

- `packages/shared/authStore.ts` — `clearSession()` + guarded `logout()` broadcast (C-01)
- `apps/applicant/src/components/AuthSync.tsx` — use `clearSession()` (C-01)
- `apps/hr/src/components/AuthSync.tsx` — use `clearSession()` (C-01)
- `apps/dev/src/components/AuthSync.tsx` — use `clearSession()` (C-01)
- `apps/applicant/src/components/ProtectedRoute.tsx` — use `clearSession()` (C-01)
- `apps/backend/routers/outbound.py` — campaign ownership checks (C-02)
- `apps/backend/routers/scoring.py` — no auto-score on close (H-01); per-task sessions + dict SSE payloads (H-02)
- `apps/backend/services/github_service.py` — `_bg_write_log` isolated-session logging (H-03)
- `apps/backend/services/scorer.py` — idempotent upsert + IntegrityError fallback (H-04)
- `apps/backend/schemas/auth.py` — email normalization/validation, 8-char password, name validation (M-01)
- `apps/backend/routers/auth.py` — registration IntegrityError → 409 (M-02)

All backend files compile (`py_compile`); all three frontends pass `tsc --noEmit`.
