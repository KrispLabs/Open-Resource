# Runtime Validation — Stabilization Sprint

## TypeScript Checks

```
cd apps/hr && tsc --noEmit          → exit:0 (clean)
cd apps/applicant && tsc --noEmit   → exit:0 (clean)
cd apps/dev && tsc --noEmit         → exit:0 (clean)
```

## Build Verification

### HR Portal
```
vite v8.0.13 building client environment for production...
✓ 1691 modules transformed.
dist/assets/vendor-ui-*.js       6.41 kB
dist/assets/vendor-query-*.js   29.65 kB
dist/assets/vendor-net-*.js     48.18 kB
dist/assets/index-*.js         101.72 kB   ← down from ~341 KB monolith
dist/assets/vendor-react-*.js  156.38 kB
✓ built in 143ms
```

### Applicant Portal
```
vite v8.0.13 building client environment for production...
✓ 1685 modules transformed.
dist/assets/vendor-ui-*.js       2.75 kB
dist/assets/vendor-query-*.js   24.26 kB
dist/assets/vendor-net-*.js     48.18 kB
dist/assets/index-*.js          51.66 kB   ← down from ~282 KB monolith
dist/assets/vendor-react-*.js  156.38 kB
✓ built in 91ms
```

### Dev Portal
```
vite v8.0.13 building client environment for production...
✓ 1683 modules transformed.
dist/assets/vendor-ui-*.js       2.94 kB
dist/assets/vendor-query-*.js   29.65 kB
dist/assets/vendor-net-*.js     48.18 kB
dist/assets/index-*.js          60.08 kB   ← down from ~297 KB monolith
dist/assets/vendor-react-*.js  156.29 kB
✓ built in 98ms
```

## Backend Import Check

```bash
python -c "import main; print('backend import: OK')"
→ backend import: OK

python -c "import routers.scoring; print('scoring router: OK')"
→ scoring router: OK
```

## Integration Tests

```
73 passed, 76 warnings in 3.00s
```

All 73 tests pass. No regressions introduced.

### Key tests passing:
- Phase 0: System init, provider onboarding, health endpoint
- Phase 1: E2E HR → job → apply → score → rank → applicant reveal
- Phase 2: Outbound campaign creation
- Phase 3: Provider management (rotate, disable, reconnect)
- Phase 4: Security assertions (no secrets in responses, auth required)
- Phase 5: Edge cases (duplicate apply, bad weights, role confusion)

## Regression Checks

| Check | Result |
|-------|--------|
| No `window.location.href` in portals | ✅ (confirmed from previous sprint) |
| `AuthSync` present in all portals | ✅ |
| `ErrorBoundary` present in all portals | ✅ |
| `refetchOnWindowFocus: false` in QueryClients | ✅ |
| `logout()` called in ProtectedRoute | ✅ |
| `USE_MOCK` flag in all portal clients | ✅ |
| Unauthenticated `/files` → 403 | ✅ (confirmed from previous sprint) |
| Rate limit → 429 | ✅ (confirmed from previous sprint) |
| Security headers on all responses | ✅ (confirmed from previous sprint) |
| Shared package exports valid | ✅ (tsc passes in all 3 portals) |
