# Deployment Report — Open Resource

**Date:** 2026-05-30
**Branch:** `outbound-v3-rebuild`
**Target:** Frontends → Vercel · Backend → Render (free Docker)
**Status:** ✅ Build-ready & configured · ⏳ Live deploy pending account auth (Vercel token + Render account)

---

## 1. Repository analysis

A pnpm workspace monorepo, not a single app:

| Component | Path | Stack | Deploy target |
|-----------|------|-------|---------------|
| HR portal | `apps/hr` | Vite + React 18 + TS (SPA) | Vercel (static) |
| Applicant portal | `apps/applicant` | Vite + React 18 + TS (SPA) | Vercel (static) |
| Dev/admin portal | `apps/dev` | Vite + React 18 + TS (SPA) | Vercel (static) |
| Backend API | `apps/backend` | FastAPI + Uvicorn + SQLAlchemy/SQLite | Render (Docker) |
| Shared lib | `packages/shared` | TS types/constants/api client | consumed by all 3 SPAs |

Backend: 38 routes across auth, jobs, applications, scoring (SSE), outbound, dev, files,
setup. Featherless AI for scoring/JD/outreach; GitHub + optional Bright Data for sourcing.

## 2. Key architectural finding (the deciding constraint)

**The backend cannot run on Vercel/any serverless platform.** It relies on:

- **SSE** live scoring stream — `routers/scoring.py:204` (`StreamingResponse`, keepalive
  loop `while completed < total` at L330). Serverless functions buffer + time out.
- **Long-running `asyncio` background tasks** — `scoring.py:33`, `routers/outbound.py`
  (campaigns run for minutes). Serverless functions die when the response ends.
- **SQLite file** `hireai.db` and **local PDF uploads** — need a persistent filesystem.

This matches `CLAUDE.md` → *Key Constraints* ("no serverless or Cloudflare Workers for
backend"). **Decision:** backend → Render (always-on container, runs the code unchanged);
frontends → Vercel (ideal for static SPAs). Cloudflare Workers was considered and rejected
for the backend (Pyodide/WASM can't run `pymupdf`/`bcrypt`, no filesystem, SQLAlchemy can't
talk to D1) — same serverless wall.

## 3. Build / type / lint verification (local)

| Check | Result |
|-------|--------|
| `apps/hr` `pnpm build` (`tsc && vite build`) | ✅ clean — 1692 modules, no errors |
| `apps/applicant` `pnpm build` | ✅ clean — 1686 modules |
| `apps/dev` `pnpm build` | ✅ clean — 1685 modules |
| TypeScript | ✅ `tsc` (strict: `noUnusedLocals`, `noUnusedParameters`) runs in build, clean |
| ESLint | ⚠️ none configured (no eslint config, no `lint` script in any app). `tsc` is the gate. |
| Backend `import main` | ✅ OK |
| Backend boot + `/health` | ✅ `{"status":"ok","db":"connected","featherless":"ready","github_sourcing":"ready"}` |
| `POST /auth/login` (seeded HR) | ✅ JWT returned |

**No build errors, TypeScript errors, or deployment-blocking lint errors were found.**
The codebase was already healthy; nothing needed fixing for compilation.

## 4. Changes made for deployability

| File | Change | Root cause |
|------|--------|-----------|
| `apps/backend/Dockerfile` | CMD now binds `${PORT:-8000}` (shell form) | Render/Fly inject `$PORT`; the hardcoded `8000` would not receive routed traffic. Local default preserved. |
| `apps/backend/config.py` | Added `cors_origin_regex` (default `https://.*\.vercel\.app`) | Vercel preview URLs rotate per commit; exact-match CORS would block them. |
| `apps/backend/main.py` | CORS uses trimmed origin list + `allow_origin_regex` | Allow both explicit prod origins and all Vercel deploys; strip stray whitespace from `FRONTEND_ORIGINS`. |
| `render.yaml` (new) | Render Blueprint: Docker web service, free plan, health check, env var scaffold, auto-generated `JWT_SECRET`/`SERVER_SECRET_KEY` | One-click backend provisioning. |
| `apps/{hr,applicant,dev}/vercel.json` (new) | Vite preset, `dist` output, SPA rewrite `/(.*) → /index.html` | Without the rewrite, React Router deep-links/refreshes 404 on Vercel. |
| `DEPLOYMENT.md`, `deployment-checklist.md`, this report (new) | Full runbook | — |

All changes re-verified: backend imports clean after edits; CORS regex loads correctly.

## 5. Functional readiness (verified locally; confirm in prod per checklist)

- **Auth** — seeded HR/dev login returns JWT; applicant self-register supported. ✅ locally
- **AI workflows** — `/health` reports `featherless: ready`; JD analysis, scoring, outreach
  call Featherless. Requires `FEATHERLESSAI_API_KEY` on Render. (Verify live in checklist.)
- **Resume uploads** — `routers/files.py` writes to `UPLOAD_DIR` with auth + path-traversal
  guards. Works; **ephemeral on Render free tier** (see §7).
- **GitHub sourcing** — `/health` reports `github_sourcing: ready`; needs `GITHUB_TOKEN`
  (or `BRIGHTDATA_API_KEY`). (Verify live.)
- **Outreach generation** — generated + stored; send is mocked by design.

> AI/sourcing/outreach make real external API calls, so end-to-end confirmation requires the
> live backend with keys set. Steps are in `deployment-checklist.md` → *Post-deploy smoke*.

## 6. Remaining steps to go live (require your credentials)

1. Push this branch to GitHub (incl. new configs).
2. **Render:** Blueprint deploy `render.yaml`, set provider keys → get backend URL.
3. **Vercel:** for each app, link project (Root Dir = `apps/<app>`), set `VITE_API_URL`,
   `vercel --prod` → get 3 URLs.
4. Set Render `FRONTEND_ORIGINS` to the 3 Vercel URLs.
5. Run the post-deploy smoke checklist.

I cannot complete 2–4 autonomously: Vercel needs an interactive `vercel login` or a
`VERCEL_TOKEN`, and Render needs your account/repo connection (or a Render API key).

## 7. Known limitations (free tier)

- **Cold starts** (~50 s) after ~15 min idle on Render free.
- **Ephemeral storage** — `hireai.db` + uploads reset on spin-down/redeploy. App still works
  (auto re-seeds). Durable option: free Neon Postgres for `DATABASE_URL` (+ object storage
  for uploads). Documented in `DEPLOYMENT.md`.

## 8. Security note

Live-looking API keys exist in `apps/hr/.env` (Featherless, a GitHub PAT, Bright Data).
`.env` is gitignored and **not** committed (verified). If these were ever shared/exposed,
**rotate them**. Production keys belong only in Render/Vercel dashboards.
