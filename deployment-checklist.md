# Deployment Checklist — Open Resource

Frontends → Vercel · Backend → Render (free Docker). Work top to bottom.

## Pre-flight (local) — ✅ done by this pass
- [x] Repo analyzed; frontend/backend architecture identified
- [x] `apps/hr` production build — clean (no TS/build errors)
- [x] `apps/applicant` production build — clean
- [x] `apps/dev` production build — clean
- [x] Backend imports (`python -c "import main"`) — OK
- [x] Backend boots + `/health` → `{"status":"ok"}`
- [x] `POST /auth/login` (seeded HR) → JWT returned
- [x] 38 API routes registered (`/openapi.json`)
- [x] All env vars catalogued (see DEPLOYMENT.md)
- [x] `Dockerfile` honors `$PORT`
- [x] CORS supports explicit origins + `*.vercel.app` regex
- [x] `render.yaml` blueprint created
- [x] `apps/{hr,applicant,dev}/vercel.json` created (SPA rewrite + vite preset)
- [x] DEPLOYMENT.md written

## Secrets hygiene
- [x] `.env` files are gitignored (confirmed not tracked)
- [ ] **Rotate** the keys currently in `apps/hr/.env` if ever shared (Featherless, GitHub PAT, Bright Data)
- [ ] Real keys entered only in Render/Vercel dashboards — never committed

## Backend → Render
- [ ] Push branch (incl. `render.yaml`, Dockerfile, CORS changes) to GitHub
- [ ] Render → New → Blueprint → connect `KrispLabs/Open-Resource` → `render.yaml`
- [ ] Set prompted secrets: `FEATHERLESSAI_API_KEY`, `GITHUB_TOKEN`, `BRIGHTDATA_API_KEY`, `HR_PASSWORD`, `DEV_PASSWORD`
- [ ] Apply → wait for first Docker build
- [ ] `curl https://<svc>.onrender.com/health` → `status: ok`, `featherless: ready`, `github_sourcing: ready`
- [ ] Record backend URL: `____________________`

## Frontends → Vercel (repeat per app: hr, applicant, dev)
- [ ] `vercel login` (or supply `VERCEL_TOKEN`)
- [ ] `cd apps/<app> && vercel link` — Root Directory = `apps/<app>`
- [ ] `vercel env add VITE_API_URL production` = backend URL
- [ ] `vercel env add VITE_API_URL preview` = backend URL
- [ ] `vercel --prod`
- [ ] Record URL: hr `__________` · applicant `__________` · dev `__________`

## Wire CORS
- [ ] Render → `FRONTEND_ORIGINS` = the 3 Vercel prod URLs (comma-separated)
- [ ] Save → redeploy

## Post-deploy smoke (production)
- [ ] HR portal loads; deep-link refresh works (SPA rewrite)
- [ ] Login as `hr@openresource.com` / `demo1234` → dashboard
- [ ] Applicant self-register + login
- [ ] Dev portal login as `admin@openresource.com`
- [ ] Create job → JD analysis (Featherless) returns weights
- [ ] Apply with a PDF resume → upload succeeds
- [ ] Close job → SSE scoring stream populates rankings live
- [ ] Candidate panel shows reasoning/scores
- [ ] Outbound: GitHub sourcing returns profiles
- [ ] Outreach email generated per candidate
- [ ] No CORS errors in browser console
