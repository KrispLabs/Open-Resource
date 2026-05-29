# Next Priority — Remaining Stabilization Targets

## Remaining Risks (Ordered by Impact)

### HIGH — AuthSync/ErrorBoundary still triplicated

`AuthSync.tsx` and `ErrorBoundary.tsx` are still copied identically in all three portals. These could be consolidated into `packages/shared/` or a new shared React component package.

**Blocker:** Shared package currently has no React dependency. Adding it requires care to avoid version conflicts with portal React instances. Recommended approach: add a `packages/shared-react/` package with `react` and `react-router-dom` as peerDependencies.

**Risk if not fixed:** A bug in session expiry handling (AuthSync) must be fixed in 3 places. Already happened once.

---

### MEDIUM — Playwright E2E tests missing

Integration tests cover API contracts but not browser-side behavior: login flow, route guards, SSE stream rendering, score reveal timing.

**Missing scenarios:**
- Guest browsing job list → apply redirect → register → apply
- Expired token detection in browser (not just test client)
- HR login → job create → analyze → weights → publish → scoring stream UI
- Cross-tab logout via BroadcastChannel
- BackendOfflineBanner triggers and auto-dismisses

**Recommendation:** Add `apps/e2e/` with Playwright. Start with the happy-path applicant flow and the HR scoring stream.

---

### MEDIUM — passlib/crypt deprecation in Python 3.13

Backend uses `passlib` with `crypt` (deprecated in Python 3.12, removed in 3.13). 76 deprecation warnings in tests. Will break on Python 3.13 upgrade.

**Fix:** Replace passlib with `bcrypt` directly:
```python
import bcrypt
hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
bcrypt.checkpw(password.encode(), hash.encode())
```

---

### MEDIUM — `python-jose` utcnow() deprecation

`python-jose` uses `datetime.utcnow()` (deprecated Python 3.12, 43 warning occurrences in tests). Could silently break in future Python versions.

**Fix:** Pin `python-jose[cryptography]>=3.4.0` when that version releases the fix, or migrate to `joserfc` / `PyJWT`.

---

### LOW — BackendOfflineBanner polling uses raw fetch

`BackendOfflineBanner` uses `fetch()` directly rather than the portal's axios client. This means:
- The health check bypasses the auth interceptor (intentional — /health is public)
- But there's no centralized timeout or retry configuration

**Fix:** Already acceptable for a health check. No immediate action needed.

---

### LOW — Alembic migration baseline missing

Database still uses `Base.metadata.create_all()` + manual `CREATE INDEX IF NOT EXISTS`. There is no migration history, so schema changes in production require manual intervention.

**Fix:** Run `alembic init migrations`, create a baseline migration from current schema, switch from `create_all` to `alembic upgrade head` in startup.

---

### LOW — Docs endpoint exposed in all environments

`/docs` and `/redoc` are accessible in production. Minor info leak of API schema.

**Fix:** Conditional FastAPI instantiation:
```python
app = FastAPI(
    docs_url="/docs" if os.getenv("APP_ENV") != "production" else None,
    redoc_url="/redoc" if os.getenv("APP_ENV") != "production" else None,
)
```

---

## Deferred (Non-Blocking)

| Item | Reason Deferred |
|------|----------------|
| Consolidate AuthSync/ErrorBoundary into shared | Requires new shared-react package; low breakage risk as-is |
| Playwright E2E suite | Significant setup; 73 backend tests cover critical paths |
| passlib → bcrypt migration | Only affects Python 3.13+; not an immediate risk |
| Alembic baseline | No production deployment yet; current approach works for demo |
| Disable /docs in production | Minor risk; acceptable for demo phase |
