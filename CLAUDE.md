# Open Resource — CLAUDE.md

AI-powered hiring and talent orchestration platform. Screens resumes, ranks candidates, and sources developers via GitHub outbound campaigns.

## Project Structure

```
open-resource/
├── apps/
│   ├── backend/          # FastAPI Python backend
│   ├── hr/               # HR portal (Vite + React + TS)
│   ├── applicant/        # Applicant portal (Vite + React + TS)
│   └── dev/              # Dev/admin portal (Vite + React + TS)
├── packages/
│   └── shared/
│       ├── types.ts      # All shared TypeScript interfaces — read-only for frontends
│       └── constants.ts  # Shared enums and constants — read-only for frontends
├── pnpm-workspace.yaml
├── docker-compose.yml
└── .env / .env.example
```

## Agent Ownership (Multi-Agent Build)

This project is built by 4 parallel agents. Each agent owns exactly one directory — never cross boundaries.

| Agent | Owns | Never Touches |
|-------|------|---------------|
| Agent A — Backend | `apps/backend/` | Any frontend file |
| Agent B — HR Portal | `apps/hr/src/` | Backend, applicant, dev portals |
| Agent C — Applicant Portal | `apps/applicant/src/` | Backend, hr, dev portals |
| Agent D — Dev Portal + QA | `apps/dev/src/` + integration tests | Backend directly (file bug reports to A) |

`packages/shared/` — Agent A proposes changes, all others read-only. A type change there breaks all 3 frontends simultaneously. Never edit without Agent A sign-off.

## Common Commands

### All frontend apps (run from app directory)
```bash
pnpm dev          # dev server
pnpm build        # production build
pnpm lint         # ESLint
tsc --noEmit      # TypeScript check
```

### Backend
```bash
cd apps/backend
source .venv/bin/activate          # venv lives at apps/backend/.venv
pip install -r requirements.txt    # if adding new deps
uvicorn main:app --reload --host 127.0.0.1 --port 8000
# or without activating:
.venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Full stack dev (from root)
```bash
pnpm dev          # starts all 4 apps via concurrently
```

### Database
```bash
# SQLite — single file, zero setup
# File: apps/backend/hireai.db
# Reset: delete hireai.db, restart backend (auto-recreates + seeds)
```

## Tech Stack

### Frontend (all 3 portals)
- React 18 + Vite + TypeScript
- Tailwind CSS
- React Router v6
- Zustand (state management)
- `@tanstack/react-query` (server state + caching)
- `axios` (API client)
- `lucide-react` (icons)

### Backend
- Python 3.11 + FastAPI + Uvicorn
- SQLAlchemy ORM + SQLite (dev) — migrate to PostgreSQL post-demo
- Pydantic v2 for schema validation
- `python-jose` + `passlib`/bcrypt for JWT auth
- `pymupdf` for PDF parsing
- `httpx` for async GitHub API calls
- `anthropic` SDK (official)
- SSE (Server-Sent Events) for real-time scoring stream

### Third-party APIs
- **Featherless AI** — JD analysis, candidate scoring, GitHub profile scoring, outreach email generation, applicant feedback writing
- **GitHub REST API** — search developer profiles, fetch repo data for outbound sourcing (5000 req/hr with token)

## Environment Variables

```env
FEATHERLESSAI_API_KEY=
GITHUB_TOKEN=
JWT_SECRET=
JWT_EXPIRE_DAYS=7
DATABASE_URL=sqlite:///./hireai.db
HR_EMAIL=hr@openresource.com
HR_PASSWORD=demo1234
DEV_EMAIL=admin@openresource.com
DEV_PASSWORD=demo1234
UPLOAD_DIR=apps/backend/uploads
FRONTEND_ORIGINS=http://localhost:5173,http://localhost:5174,http://localhost:5175
```

## Auth

- Custom JWT — role-based: `hr` / `applicant` / `dev`
- Two seeded accounts on startup: `hr@openresource.com` (role: hr), `admin@openresource.com` (role: dev)
- Applicants self-register
- Token stored in localStorage, sent as Bearer header, 7-day expiry, no refresh token
- Row-level security enforced in FastAPI route logic (not DB-level — SQLite has no RLS)

## Database Schema (Key Tables)

- **users** — id, email, name, password_hash, role, created_at
- **jobs** — id, created_by, title, description, location, job_type, status, application_deadline, shortlist_cutoff, scoring_weights (JSON), jd_parsed (JSON), created_at, closed_at
- **applications** — id, job_id, applicant_id, resume_filename, cover_note, status, rank, submitted_at
- **candidate_scores** — id, application_id, technical_score, experience_score, project_score, education_score, communication_score, weighted_total, verdict, reasoning, strengths, gaps, matched_skills, missing_skills, interview_questions, applicant_feedback, scored_at
- **outbound_campaigns** — id, job_id, created_by, status, github_search_signals (JSON), total_found, total_contacted, created_at
- **outbound_candidates** — id, campaign_id, github_username, profile_score, matched_signals, outreach_email, outreach_status, sent_at
- **scoring_config** — global default weights; only `dev` role can write
- **system_logs** — event_type, api_provider, tokens_used, latency_ms, status, error_message

## Core Features

1. **JD Analysis** — HR posts job, Claude analyzes JD, proposes weighted scoring categories (editable sliders that must sum to 100)
2. **Batch AI Scoring** — after job closes, Claude scores every resume across 5 categories: technical_skills, experience, projects, education, communication
3. **Real-time SSE Stream** — HR watches rankings populate live; 5 event types: `session_start`, `step`, `candidate_start`, `candidate_done`, `session_done`
4. **Candidate Detail Panel** — slide-over (not full page) with AI reasoning, score breakdown, strengths, gaps, interview questions
5. **Shortlist System** — HR sets cutoff rank; everything above it is shortlisted automatically
6. **Applicant Result Visibility** — after job closes, applicants see rank, score breakdown, shortlist status, and applicant_feedback (never see full reasoning or interview questions)
7. **Outbound Sourcing** — Claude extracts signals from JD → GitHub search → profiles ranked by score → personalized outreach email generated per candidate

## UI/UX Design Rules

- **Aesthetic**: corporate-professional, data-forward — LinkedIn + Microsoft 365 + Notion + GitHub inspired. No gradients, no glow, no glassmorphism.
- **Primary color**: `#0A66C2` (LinkedIn blue) — buttons, active nav, links
- **Dark mode** (default): bg `#111318`, surface `#1C1F26`, elevated `#23272F`
- **Light mode**: bg `#FFFFFF`, surface `#F3F4F6`, elevated `#E9EAEC`
- **Fonts**: `Plus Jakarta Sans` (UI) + `JetBrains Mono` (scores/numbers) — both from Google Fonts
- **Border radius**: buttons `6px`, cards `8px`, modals `10px`, badges `4px`
- **Dark/light toggle**: sun/moon icon in top navbar, preference saved to localStorage, implemented via CSS variables (one `:root` swap — no conditional rendering)
- All colors via CSS variables only — never hardcode hex in components

## Route Map

### HR Portal
- `/login` → `/dashboard` → `/jobs/new` → `/jobs/:id/weights` → `/jobs/:id` → `/jobs/:id/scoring` → `/jobs/:id/rankings` → `/shortlist/:id` → `/outbound/:jobId` → `/campaigns/:id`
- `/candidates/:id` is a slide-over panel, not a route

### Applicant Portal
- `/login` → `/register` → `/dashboard` → `/jobs` → `/jobs/:id` → `/apply/:jobId` → `/applications/:id`
- Mobile responsive with bottom tab nav on mobile

### Dev Portal
- `/login` → `/dashboard` → `/jobs` → `/logs` → `/scoring-config` → `/api-usage`
- Desktop only — no mobile optimization needed

## Key Constraints

- SSE requires persistent HTTP connection — no serverless or Cloudflare Workers for backend
- SQLite requires persistent filesystem — no ephemeral platforms (Railway free tier resets disk)
- PDF uploads require writable `uploads/` directory that persists across restarts
- All 3 portals share one backend instance
- Claude API calls parallelized across candidates (max 5 concurrent to avoid rate limits)
- No real email delivery — outreach is generated and stored, send is mocked
- `users.password_hash` never returned in any API response
- Applicants never see `reasoning`, `interview_questions`, or `recruiter_note` — only `weighted_total`, `rank`, `applicant_feedback`, `status`

## File Storage

- Local filesystem: `apps/backend/uploads/{job_id}/{application_id}.pdf`
- Served via FastAPI `StaticFiles` at `/files/`
- Max file size: 5MB enforced at upload endpoint

## Hosting (Target)

```
sarthakg.com (MilesWeb)
├── api.sarthakg.com         → FastAPI backend (port 8000, Apache/Nginx proxy)
├── hr.openresource.com      → /public_html/hr/        (Vite build)
├── app.openresource.com     → /public_html/applicant/ (Vite build)
└── dev.openresource.com     → /public_html/dev/       (Vite build)
```

## Code Rules

1. Never commit directly to `main`. Branch per phase: `feature/phase-{N}-{agent-letter}`
2. Never hardcode colors — CSS variables only
3. Never hardcode API URLs — environment variables only
4. Never hardcode secrets — `.env` only
5. Every API call has loading, success, and error states — no silent failures
6. Never leave a TODO in submitted code — implement it or raise a blocker
7. `packages/shared/types.ts` is the source of truth for all API response shapes — if your response shape differs, update types.ts first and notify all agents

## Mock Data

During development before backend is ready, use `src/api/mock.ts` in each frontend app. All hooks check `USE_MOCK` flag in `src/api/client.ts` before calling real API. Switching from mock to real API is one flag flip — zero component changes.

## Phase Sequence (12 Days)

1. **Setup** — monorepo scaffold, all deps installed, `.env`, Docker skeleton
2. **Auth + DB** — JWT, seeded accounts, all SQLAlchemy models, health endpoint
3. **JD Analysis** — Stage 1 Claude call, jobs CRUD, weight proposal endpoint
4. **Applications** — PDF upload, apply endpoint, duplicate check, applicant list
5. **Scoring Engine** — Stage 2 Claude call, score storage, SSE stream endpoint
6. **HR Portal Core** — Dashboard, JobCreate, WeightEditor, ScoringStream
7. **Rankings + Candidate Panel** — Rankings table, slide-over, shortlist system
8. **Outbound Sourcing** — GitHub search, profile scoring, outreach generation
9. **Applicant Portal** — Job listings, apply flow, dashboard, score reveal
10. **Dev Portal** — Log viewer, scoring config editor, API usage charts
11. **UI Polish** — Dark/light mode, skeletons, empty states, toasts, mobile
12. **Integration Testing + Deploy** — Agent D done-criteria checks, live deploy

## Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| HR | hr@openresource.com | demo1234 |
| Dev/Admin | admin@openresource.com | demo1234 |
| Applicant | self-register | — |
