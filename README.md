# Open Resource

Open Resource is an agentic AI-powered hiring and talent orchestration platform for managing recruiting workflows from job creation through applicant intake, AI-assisted scoring, shortlisting, outbound sourcing, and operational monitoring.

The repository is organized as a pnpm monorepo with multiple role-specific web applications, a FastAPI backend, and a shared TypeScript package used across the frontends.

## What It Does

Open Resource helps hiring teams coordinate the full recruiting lifecycle:

- Create and manage jobs from the HR portal.
- Publish applicant-facing job flows for discovery, registration, profile management, and applications.
- Upload and parse applicant resumes.
- Analyze job descriptions and candidate resumes.
- Run AI-assisted candidate scoring with configurable weights.
- Rank, shortlist, review, and reject candidates from an HR workflow.
- Launch outbound sourcing campaigns for closed, sourcing, or interviewing roles.
- Discover and enrich GitHub-sourced candidate profiles.
- Generate outreach drafts and track outbound campaign status.
- Configure providers, inspect logs, and monitor operational health from a developer/admin portal.

## Repository Layout

```text
.
├── apps/
│   ├── backend/       # FastAPI API, database models, scoring, outbound sourcing
│   ├── hr/            # HR/recruiter web application
│   ├── applicant/     # Applicant-facing web application
│   └── dev/           # Developer/admin operations portal
├── packages/
│   └── shared/        # Shared TypeScript API/auth/types utilities
├── .env.example       # Example backend environment configuration
├── package.json       # Root workspace scripts
├── pnpm-workspace.yaml
└── README.md
```

## Applications

### Backend API

Location: `apps/backend`

The backend is a FastAPI service that owns authentication, job data, applications, resume uploads, AI scoring, provider configuration, outbound sourcing, and health checks.

Primary capabilities:

- JWT-based authentication for HR, applicant, and developer roles.
- SQLAlchemy models and SQLite by default.
- Startup database creation and seed data.
- Resume upload and PDF parsing.
- Job description analysis.
- Candidate scoring with AI provider support.
- Server-Sent Events for scoring progress.
- Outbound campaign orchestration.
- GitHub and Bright Data sourcing integrations.
- Provider credential migration/configuration.
- Security and request ID middleware.

Key backend modules:

- `routers/auth.py` - login, registration, and current-user flows.
- `routers/jobs.py` - job creation, listing, details, and job analysis.
- `routers/applications.py` - applicant submission and application management.
- `routers/scoring.py` - close-job, scoring trigger, ranking, and SSE scoring stream.
- `routers/outbound.py` - campaign creation, campaign candidates, and outreach state.
- `routers/setup.py` - setup/configuration endpoints.
- `routers/dev.py` - developer/admin diagnostics and operations.
- `services/scorer.py` - candidate scoring logic.
- `services/jd_analyzer.py` - job description analysis.
- `services/github_service.py` - outbound sourcing and GitHub enrichment.
- `services/bright_data_service.py` - optional Bright Data-backed discovery.
- `services/provider_manager.py` - provider credential lookup and migration.

### HR Portal

Location: `apps/hr`

The HR portal is the primary recruiter workspace. It includes dashboards and workflows for jobs, rankings, scoring, shortlists, outbound sourcing, and campaigns.

Notable pages:

- `Dashboard`
- `Jobs`
- `JobCreate`
- `JobDetail`
- `Rankings`
- `Shortlist`
- `WeightEditor`
- `ScoringStream`
- `Outbound`
- `Campaigns`
- `Campaign`

### Applicant Portal

Location: `apps/applicant`

The applicant portal is the candidate-facing application. It supports account creation, login, profile management, job browsing, application submission, and application tracking.

Notable pages:

- `JobList`
- `JobDetail`
- `Apply`
- `ApplicantDashboard`
- `ApplicationDetail`
- `Profile`
- `Login`
- `Register`

### Developer Portal

Location: `apps/dev`

The developer portal is the operational/admin surface for setup, provider configuration, logs, API usage, scoring configuration, and job inspection.

Notable pages:

- `DevDashboard`
- `Setup`
- `AdminProviders`
- `ApiUsage`
- `Logs`
- `ScoringConfig`
- `AllJobs`

### Shared Package

Location: `packages/shared`

The shared package contains reusable TypeScript utilities and contracts used by the web apps:

- API client utilities.
- Shared auth helpers.
- Auth store helpers.
- Diagnostics helpers.
- Common constants.
- Shared TypeScript types.

## Tech Stack

### Frontend

- React 18
- TypeScript
- Vite
- React Router
- TanStack Query
- Zustand
- Axios
- Tailwind CSS
- Lucide React
- pnpm workspaces

### Backend

- Python
- FastAPI
- Uvicorn
- SQLAlchemy
- Pydantic
- python-jose
- passlib/bcrypt
- PyMuPDF
- httpx
- Anthropic SDK
- Bright Data SDK
- SQLite by default

## Prerequisites

Install the following before running the project:

- Node.js 20 or newer
- pnpm
- Python 3.12 recommended
- Git

Optional provider credentials:

- Featherless AI API key for AI scoring and outreach generation.
- GitHub Personal Access Token for profile enrichment.
- Bright Data API key for enhanced candidate discovery.

## Environment Variables

Start from the example file:

```bash
cp .env.example apps/backend/.env
```

The backend reads environment variables from `apps/backend/.env` when run from the backend directory.

Important variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLAlchemy database URL. Defaults to local SQLite. |
| `JWT_SECRET` | Secret used for JWT signing. Must be changed outside local development. |
| `JWT_EXPIRE_DAYS` | JWT lifetime in days. |
| `SERVER_SECRET_KEY` | Secret used for provider credential encryption. Must be changed outside local development. |
| `HR_EMAIL` | Seeded HR user email. |
| `HR_PASSWORD` | Seeded HR user password. |
| `DEV_EMAIL` | Seeded developer/admin user email. |
| `DEV_PASSWORD` | Seeded developer/admin user password. |
| `UPLOAD_DIR` | Directory used for uploaded resumes. |
| `FRONTEND_ORIGINS` | Comma-separated list of allowed frontend origins. |
| `FEATHERLESSAI_API_KEY` | Required for AI scoring and outbound AI generation. |
| `GITHUB_TOKEN` | Required for GitHub profile enrichment in outbound campaigns. |
| `BRIGHTDATA_API_KEY` | Optional enhanced sourcing provider. |
| `BRIGHTDATA_DATASET_ID` | Bright Data GitHub profiles dataset ID. |
| `BRIGHTDATA_SERP_DATASET_ID` | Bright Data SERP dataset ID. |

The repository-level `.gitignore` excludes `.env` files, local databases, build outputs, uploads, Python caches, and virtual environments. Keep real provider keys and local credentials out of commits.

## Installation

Install JavaScript dependencies from the repository root:

```bash
pnpm install
```

Create a Python virtual environment for the backend:

```bash
cd apps/backend
python3.12 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

If `python3.12` is unavailable, use the local Python 3 version available on your machine.

## Running Locally

From the repository root, run all applications together:

```bash
pnpm dev
```

This starts:

- Backend API: `http://127.0.0.1:8000`
- HR portal: Vite dev server, typically `http://localhost:5173`
- Applicant portal: Vite dev server, typically `http://localhost:5174`
- Developer portal: Vite dev server, typically `http://localhost:5175`

Vite may choose the next available port if one of these ports is already in use.

Run individual apps with pnpm filters:

```bash
pnpm --filter backend dev
pnpm --filter hr dev
pnpm --filter applicant dev
pnpm --filter dev-portal dev
```

Backend health check:

```bash
curl http://127.0.0.1:8000/health
```

## Build

Build all workspace packages:

```bash
pnpm build
```

Build a single frontend:

```bash
pnpm --filter hr build
pnpm --filter applicant build
pnpm --filter dev-portal build
```

## Tests

Backend tests live in `apps/backend/tests`.

Run them from the backend directory after installing Python dependencies:

```bash
cd apps/backend
. .venv/bin/activate
pytest
```

## Default Local Accounts

The backend seeds local users using environment variables.

| Role | Default Email | Default Password |
| --- | --- | --- |
| HR | `hr@openresource.com` | `demo1234` |
| Developer/Admin | `admin@openresource.com` | `demo1234` |

Change these values for any shared, staged, or production environment.

## Core Workflows

### HR Hiring Flow

1. Log in to the HR portal.
2. Create a job.
3. Review applicants as they submit applications.
4. Close the job when ready to evaluate.
5. Start scoring manually.
6. Watch scoring progress in the scoring stream.
7. Review rankings and candidate score breakdowns.
8. Move candidates through shortlist and review states.

### Applicant Flow

1. Register or log in through the applicant portal.
2. Complete profile details.
3. Browse available jobs.
4. Apply to a job and upload a resume.
5. Track application status from the applicant dashboard.

### Outbound Sourcing Flow

1. Configure required providers.
2. Analyze the job description.
3. Close the job or move it into a sourcing-compatible state.
4. Create an outbound campaign for the job.
5. Let the backend discover and enrich candidate profiles.
6. Review campaign candidates.
7. Send generated outreach drafts.

Provider requirements:

- Featherless AI must be configured before launching campaigns.
- GitHub token must be configured for profile enrichment.
- Bright Data is optional and can enhance discovery.

### Developer/Admin Flow

1. Log in to the developer portal.
2. Complete setup and provider configuration.
3. Review API usage and logs.
4. Inspect all jobs and scoring configuration.
5. Export diagnostics when needed.

## API Overview

The backend exposes a FastAPI app with grouped routers for:

- Authentication
- Jobs
- Applications
- Files
- Scoring
- Setup
- Outbound campaigns
- Developer/admin operations

Useful endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Service, database, and provider readiness health check. |
| `POST /auth/login` | Authenticate users. |
| `GET /jobs` | List jobs. |
| `POST /jobs` | Create jobs. |
| `POST /jobs/{job_id}/analyze` | Analyze a job description. |
| `POST /jobs/{job_id}/close` | Close a job for evaluation. |
| `POST /jobs/{job_id}/score` | Start candidate scoring. |
| `GET /jobs/{job_id}/stream` | Stream scoring progress. |
| `POST /api/jobs/{job_id}/campaigns` | Create an outbound campaign. |
| `GET /api/campaigns` | List outbound campaigns. |

FastAPI also provides generated interactive API docs while the backend is running:

- `http://127.0.0.1:8000/docs`
- `http://127.0.0.1:8000/redoc`

## Data and Generated Files

Local development creates files that should not be committed:

- SQLite databases such as `hireai.db`.
- SQLite sidecar files such as `*.db-shm` and `*.db-wal`.
- Uploaded resumes under `apps/backend/uploads/`.
- Build output under frontend `dist/` directories.
- Python virtual environments and caches.
- Local `.env` files.

The repository keeps `apps/backend/uploads/.gitkeep` so the upload directory can exist without committing uploaded files.

## Security Notes

- Do not use the default JWT or server secret in production.
- Do not commit `.env` files or provider keys.
- Configure production CORS through `FRONTEND_ORIGINS`.
- Use a persistent production-grade database instead of local SQLite for deployed environments.
- Treat uploaded resumes as sensitive personal data.
- Review provider credential storage and rotation before deploying.

## Troubleshooting

### Backend Starts but Health Is Degraded

Check database connectivity and confirm the backend is running from `apps/backend` with a valid `.env`.

### Scoring Fails or Stays Pending

Confirm `FEATHERLESSAI_API_KEY` is configured either in the backend `.env` or through the developer portal provider configuration.

### Outbound Campaign Creation Fails

Confirm:

- The job has been analyzed.
- The job is in a campaign-compatible state.
- Featherless AI is configured.
- `GITHUB_TOKEN` is configured.

### Frontend Cannot Reach the API

Check that the backend is running on `http://127.0.0.1:8000` and that `FRONTEND_ORIGINS` includes the active Vite dev server origins.

### Port Already in Use

Vite may automatically choose the next available frontend port. Update `FRONTEND_ORIGINS` if a frontend runs on a different port and the backend rejects browser requests.

## Live Deployment

The platform is deployed and publicly accessible.

| Surface | URL |
| --- | --- |
| HR portal | https://open-resource-hr.vercel.app |
| Applicant portal | https://open-resource-applicant.vercel.app |
| Admin (dev) portal | https://open-resource-admin.vercel.app |
| Backend API | https://open-resource-api.onrender.com |
| API docs (interactive) | https://open-resource-api.onrender.com/docs |

Demo accounts:

| Role | Email | Password |
| --- | --- | --- |
| HR | hr@openresource.com | demo1234 |
| Admin | admin@openresource.com | demo1234 |
| Applicant | self-register via applicant portal | — |

The three frontend SPAs are hosted on Vercel. The FastAPI backend runs on Render (free tier, Docker). See `DEPLOYMENT.md` for the full deployment guide including environment variable reference, CORS configuration, and free-tier caveats.

## Project Status

This is an active product codebase. The architecture currently favors local-first development with SQLite, role-specific Vite frontends, and a FastAPI backend that can be extended toward production deployment with stronger secrets, managed storage, a managed database, and provider credential hardening.
