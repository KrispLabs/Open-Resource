"""
Integration tests — Open Resource backend.

Phases:
  0 — System initialisation & provider onboarding
  1 — Happy-path E2E (HR → job → apply → score → rank → applicant reveal)
  2 — Outbound campaign creation
  3 — Provider management (rotate, disable, reconnect)
  4 — Security assertions (no secrets in API responses)
  5 — Edge cases (duplicate apply, bad weights, role confusion, etc.)

Run: cd apps/backend && .venv/bin/pytest -v
"""
import io
import json
import time
import pytest

from tests.conftest import MINIMAL_PDF, LONG_JD, state

# FastAPI's HTTPBearer raises 403 when the Authorization header is missing.
# Tests for unauthenticated access accept both 401 and 403.
NO_AUTH = frozenset({401, 403})

VALID_WEIGHTS = {
    "technical_skills": 40,
    "experience": 25,
    "projects": 20,
    "education": 8,
    "communication": 7,
}


# ─────────────────────────────────────────────────────────────────────────────
# Phase 0 — System Initialisation
# ─────────────────────────────────────────────────────────────────────────────

class TestPhase0_SystemInit:

    def test_health_endpoint(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] in ("ok", "degraded")
        assert "db" in body

    def test_setup_status_public_no_auth(self, client):
        """GET /api/setup/status must be reachable without any token."""
        r = client.get("/api/setup/status")
        assert r.status_code == 200
        body = r.json()
        assert "configured" in body
        assert "providers" in body
        for p in body["providers"]:
            assert "id" in p
            assert "configured" in p
            assert "required" in p

    def test_setup_status_featherless_configured(self, client):
        """Startup migrate_env_to_db should have picked up FEATHERLESSAI_API_KEY."""
        r = client.get("/api/setup/status")
        assert r.status_code == 200
        providers = {p["id"]: p for p in r.json()["providers"]}
        assert providers["featherless"]["configured"] is True

    def test_list_providers_requires_auth(self, client):
        """GET /api/providers must reject unauthenticated requests."""
        r = client.get("/api/providers")
        assert r.status_code in NO_AUTH

    def test_list_providers_as_dev(self, client, dev_headers):
        r = client.get("/api/providers", headers=dev_headers)
        assert r.status_code == 200
        providers = r.json()
        assert isinstance(providers, list)
        ids = [p["id"] for p in providers]
        assert "featherless" in ids
        assert "brightdata" in ids
        assert "github" in ids

    def test_providers_never_expose_raw_secrets(self, client, dev_headers):
        """Provider list must never include raw credential values."""
        r = client.get("/api/providers", headers=dev_headers)
        assert r.status_code == 200
        body = r.text
        assert "test-featherless-key-integration" not in body

    def test_configure_github_provider(self, client, dev_headers):
        """Configure the GitHub provider with a test token."""
        r = client.post(
            "/api/providers/configure",
            headers=dev_headers,
            json={"provider": "github", "values": {"token": "ghp_test_token_integration"}},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["provider"] == "github"
        assert "health" in body
        state["github_configured"] = True

    def test_configure_unknown_provider_400(self, client, dev_headers):
        r = client.post(
            "/api/providers/configure",
            headers=dev_headers,
            json={"provider": "nonexistent_provider", "values": {"api_key": "x"}},
        )
        assert r.status_code == 400

    def test_hr_cannot_manage_providers(self, client, hr_headers):
        """HR role must be rejected from provider management endpoints."""
        r = client.get("/api/providers", headers=hr_headers)
        assert r.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# Phase 1 — Happy-Path E2E
# ─────────────────────────────────────────────────────────────────────────────

class TestPhase1_HappyPath:

    # ── Auth ──────────────────────────────────────────────────────────────────

    def test_hr_login(self, client):
        r = client.post("/auth/login", json={"email": "hr@openresource.com", "password": "demo1234"})
        assert r.status_code == 200
        body = r.json()
        assert body["role"] == "hr"
        assert "access_token" in body
        assert "user_id" in body
        state["hr_token"] = body["access_token"]

    def test_hr_me(self, client, hr_headers):
        r = client.get("/auth/me", headers=hr_headers)
        assert r.status_code == 200
        assert r.json()["role"] == "hr"

    def test_wrong_password_returns_401(self, client):
        r = client.post("/auth/login", json={"email": "hr@openresource.com", "password": "wrong"})
        assert r.status_code == 401

    def test_unauthenticated_job_post_rejected(self, client):
        """POST /jobs without token returns 401 or 403."""
        r = client.post("/jobs", json={"title": "X", "description": "Y", "job_type": "remote"})
        assert r.status_code in NO_AUTH

    # ── Job lifecycle ─────────────────────────────────────────────────────────

    def test_create_job(self, client, hr_headers):
        r = client.post("/jobs", headers=hr_headers, json={
            "title": "Integration Test Engineer",
            "description": LONG_JD,
            "location": "Remote",
            "job_type": "remote",
        })
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["status"] == "draft"
        assert body["title"] == "Integration Test Engineer"
        state["job_id"] = body["id"]

    def test_description_too_short_rejected(self, client, hr_headers):
        """Job description under 50 words must return 422."""
        r = client.post("/jobs", headers=hr_headers, json={
            "title": "Short",
            "description": "Too short.",
            "job_type": "remote",
        })
        assert r.status_code == 422

    def test_analyze_jd(self, client, hr_headers, featherless_mock):
        job_id = state["job_id"]
        r = client.post(f"/jobs/{job_id}/analyze", headers=hr_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        parsed = body["jd_parsed"]
        assert "proposed_weights" in parsed
        weights = parsed["proposed_weights"]
        assert abs(sum(weights.values()) - 100) < 1

    def test_get_job_weights(self, client, hr_headers):
        r = client.get(f"/jobs/{state['job_id']}/weights", headers=hr_headers)
        assert r.status_code == 200
        body = r.json()
        assert "current_weights" in body
        assert "proposed_weights" in body

    def test_publish_job(self, client, hr_headers):
        r = client.post(f"/jobs/{state['job_id']}/publish", headers=hr_headers, json={
            "scoring_weights": VALID_WEIGHTS
        })
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "active"

    def test_published_job_visible_to_applicant(self, client):
        """Active job must be accessible with auth."""
        r = client.post("/auth/login", json={"email": "demo@applicant.com", "password": "demo1234"})
        assert r.status_code == 200
        token = r.json()["access_token"]
        r = client.get(
            f"/jobs/{state['job_id']}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200

    def test_publish_already_active_job_400(self, client, hr_headers):
        r = client.post(f"/jobs/{state['job_id']}/publish", headers=hr_headers, json={
            "scoring_weights": VALID_WEIGHTS
        })
        assert r.status_code == 400

    # ── Application flow ──────────────────────────────────────────────────────

    def test_register_applicant(self, client):
        r = client.post("/auth/register", json={
            "email": "testapplicant@integration.test",
            "name": "Test Applicant",
            "password": "testpass123",
        })
        assert r.status_code == 201
        body = r.json()
        assert body["role"] == "applicant"
        state["applicant_token"] = body["access_token"]
        state["applicant_id"] = body["user_id"]

    def test_duplicate_registration_409(self, client):
        r = client.post("/auth/register", json={
            "email": "testapplicant@integration.test",
            "name": "Test Applicant",
            "password": "testpass123",
        })
        assert r.status_code == 409

    def test_apply_to_job(self, client):
        job_id = state["job_id"]
        r = client.post(
            f"/jobs/{job_id}/apply",
            headers={"Authorization": f"Bearer {state['applicant_token']}"},
            files={"resume": ("resume.pdf", io.BytesIO(MINIMAL_PDF), "application/pdf")},
            data={"cover_note": "I am a strong Python engineer with 6 years FastAPI experience."},
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["job_id"] == job_id
        state["application_id"] = body["id"]

    def test_applicant_list_own_applications(self, client):
        r = client.get(
            "/applications",
            headers={"Authorization": f"Bearer {state['applicant_token']}"},
        )
        assert r.status_code == 200
        assert any(a["id"] == state["application_id"] for a in r.json())

    def test_hr_list_applications(self, client, hr_headers):
        r = client.get(f"/jobs/{state['job_id']}/applications", headers=hr_headers)
        assert r.status_code == 200
        assert any(a["id"] == state["application_id"] for a in r.json())

    # ── Close + score ────────────────────────────────────────────────────────

    def test_close_job(self, client, hr_headers):
        r = client.post(
            f"/jobs/{state['job_id']}/close",
            headers=hr_headers,
            json={"shortlist_cutoff": 3},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "closed"

    def test_trigger_scoring_on_closed_job(self, client, hr_headers):
        r = client.post(f"/jobs/{state['job_id']}/score", headers=hr_headers)
        assert r.status_code == 200
        assert "job_id" in r.json()

    def test_sse_scoring_stream(self, client, hr_headers, featherless_mock):
        """Stream scores — verify all required SSE event types emitted."""
        job_id = state["job_id"]
        events = []
        with client.stream("GET", f"/jobs/{job_id}/stream", headers=hr_headers) as resp:
            assert resp.status_code == 200
            assert "text/event-stream" in resp.headers.get("content-type", "")
            for line in resp.iter_lines():
                if line.startswith("data:"):
                    raw = line[5:].strip()
                    try:
                        events.append(json.loads(raw))
                    except json.JSONDecodeError:
                        pass

        event_types = [e.get("type") for e in events]
        assert "session_start" in event_types, f"Events: {event_types}"
        assert "session_done" in event_types, f"Events: {event_types}"
        state["sse_events"] = events

    def test_sse_session_done_has_counts(self):
        """session_done payload must include shortlisted/not_shortlisted counts."""
        events = state.get("sse_events", [])
        done = next((e for e in events if e.get("type") == "session_done"), None)
        assert done is not None, "session_done event missing"
        payload = done.get("payload", {})
        assert "shortlisted" in payload
        assert "not_shortlisted" in payload

    # ── Rankings ─────────────────────────────────────────────────────────────

    def test_get_rankings(self, client, hr_headers):
        r = client.get(f"/jobs/{state['job_id']}/rankings", headers=hr_headers)
        assert r.status_code == 200
        rankings = r.json()
        assert isinstance(rankings, list)
        assert len(rankings) >= 1
        state["rankings"] = rankings

    def test_rankings_have_candidate_scores(self):
        """At least one ranking entry must have candidate_scores after scoring."""
        ranked_with_scores = [
            e for e in state.get("rankings", []) if e.get("candidate_scores")
        ]
        assert len(ranked_with_scores) >= 1

    def test_applicant_score_reveal_after_close(self, client):
        """Applicant can see their score after job closes — but NOT reasoning or questions."""
        r = client.get(
            f"/applications/{state['application_id']}",
            headers={"Authorization": f"Bearer {state['applicant_token']}"},
        )
        assert r.status_code == 200
        body = r.json()
        # After close, scores should be present
        if body.get("scores"):
            s = body["scores"]
            assert "weighted_total" in s
            assert "applicant_feedback" in s
            # HR-only fields must be absent
            assert "reasoning" not in s
            assert "interview_questions" not in s

    def test_dev_can_see_rankings(self, client, dev_headers):
        r = client.get(f"/jobs/{state['job_id']}/rankings", headers=dev_headers)
        assert r.status_code == 200


# ─────────────────────────────────────────────────────────────────────────────
# Phase 2 — Outbound Campaign
# ─────────────────────────────────────────────────────────────────────────────

class TestPhase2_OutboundCampaign:

    def _create_active_job(self, client, hr_headers) -> str:
        r = client.post("/jobs", headers=hr_headers, json={
            "title": "Campaign Test Active Job",
            "description": LONG_JD,
            "location": "Remote",
            "job_type": "remote",
        })
        assert r.status_code == 201
        job_id = r.json()["id"]
        client.post(f"/jobs/{job_id}/publish", headers=hr_headers,
                    json={"scoring_weights": VALID_WEIGHTS})
        return job_id

    def test_campaign_on_active_job_rejected(self, client, hr_headers):
        """Cannot create a campaign on a job that is still active."""
        job_id = self._create_active_job(client, hr_headers)
        r = client.post(f"/api/jobs/{job_id}/campaigns", headers=hr_headers)
        assert r.status_code == 400

    def test_create_campaign_on_closed_job(self, client, hr_headers):
        """Campaign creation on the closed integration test job must succeed."""
        job_id = state["job_id"]
        r = client.post(f"/api/jobs/{job_id}/campaigns", headers=hr_headers)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["status"] == "running"
        assert "campaign_id" in body
        state["campaign_id"] = body["campaign_id"]

    def test_get_campaign(self, client, hr_headers):
        campaign_id = state.get("campaign_id")
        if not campaign_id:
            pytest.skip("No campaign created")
        r = client.get(f"/api/campaigns/{campaign_id}", headers=hr_headers)
        assert r.status_code == 200
        assert r.json()["id"] == campaign_id

    def test_get_campaign_candidates(self, client, hr_headers):
        """Candidates endpoint returns a list (empty is OK — no real API keys)."""
        campaign_id = state.get("campaign_id")
        if not campaign_id:
            pytest.skip("No campaign created")
        time.sleep(0.3)  # brief wait for background task to settle
        r = client.get(f"/api/campaigns/{campaign_id}/candidates", headers=hr_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_send_all_returns_sent_count(self, client, hr_headers):
        """send-all returns {sent: N} — N=0 is fine if no draft candidates."""
        campaign_id = state.get("campaign_id")
        if not campaign_id:
            pytest.skip("No campaign created")
        r = client.post(f"/api/campaigns/{campaign_id}/send-all", headers=hr_headers)
        assert r.status_code == 200
        assert r.json()["sent"] >= 0

    def test_nonexistent_campaign_returns_404(self, client, hr_headers):
        r = client.get("/api/campaigns/nonexistent-uuid-here", headers=hr_headers)
        assert r.status_code == 404


# ─────────────────────────────────────────────────────────────────────────────
# Phase 3 — Provider Management
# ─────────────────────────────────────────────────────────────────────────────

class TestPhase3_ProviderManagement:

    def test_validate_featherless_provider(self, client, dev_headers, featherless_mock):
        r = client.post("/api/providers/featherless/validate", headers=dev_headers)
        assert r.status_code == 200
        body = r.json()
        assert "healthy" in body
        assert "last_checked" in body

    def test_rotate_provider_credentials(self, client, dev_headers, featherless_mock):
        """Rotate featherless key — endpoint returns health status."""
        r = client.post(
            "/api/providers/featherless/rotate",
            headers=dev_headers,
            json={
                "provider": "featherless",
                "values": {
                    "api_key": "new-rotated-test-key",
                    "model": "meta-llama/Meta-Llama-3.1-8B-Instruct",
                },
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["provider"] == "featherless"
        assert "health" in body

    def test_provider_still_configured_after_rotation(self, client, dev_headers):
        r = client.get("/api/providers", headers=dev_headers)
        assert r.status_code == 200
        providers = {p["id"]: p for p in r.json()}
        assert providers["featherless"]["configured"] is True

    def test_disable_github_provider(self, client, dev_headers):
        r = client.delete("/api/providers/github", headers=dev_headers)
        assert r.status_code == 200
        assert r.json()["success"] is True

    def test_disabled_provider_shows_unconfigured(self, client, dev_headers):
        r = client.get("/api/providers", headers=dev_headers)
        assert r.status_code == 200
        providers = {p["id"]: p for p in r.json()}
        assert providers["github"]["configured"] is False
        assert providers["github"]["status"] == "unconfigured"

    def test_reconfigure_disabled_provider(self, client, dev_headers, github_api_mock):
        """Re-adding credentials to a disabled provider should succeed."""
        r = client.post(
            "/api/providers/configure",
            headers=dev_headers,
            json={"provider": "github", "values": {"token": "ghp_reconnected_test"}},
        )
        assert r.status_code == 200

    def test_disable_nonexistent_provider_404(self, client, dev_headers):
        r = client.delete("/api/providers/does_not_exist", headers=dev_headers)
        assert r.status_code == 404

    def test_rotate_nonexistent_provider_404(self, client, dev_headers):
        r = client.post(
            "/api/providers/no_such_provider/rotate",
            headers=dev_headers,
            json={"provider": "no_such_provider", "values": {}},
        )
        assert r.status_code == 404


# ─────────────────────────────────────────────────────────────────────────────
# Phase 4 — Security Assertions
# ─────────────────────────────────────────────────────────────────────────────

class TestPhase4_Security:

    def test_no_raw_secrets_in_providers_list(self, client, dev_headers):
        r = client.get("/api/providers", headers=dev_headers)
        assert r.status_code == 200
        body = r.text
        # Exact credential values must never appear in the response
        for secret in [
            "test-featherless-key-integration",
            "new-rotated-test-key",
            "ghp_reconnected_test",
            "ghp_test_token_integration",
        ]:
            assert secret not in body, f"Secret '{secret}' leaked in providers list"

    def test_no_secrets_in_setup_status(self, client):
        """Setup status is public — must never leak credential values."""
        r = client.get("/api/setup/status")
        assert r.status_code == 200
        body = r.text
        assert "test-featherless-key" not in body
        assert "ghp_" not in body

    def test_applicant_cannot_see_reasoning_field(self, client):
        """Applicant view must omit reasoning and interview_questions."""
        r = client.get(
            f"/applications/{state['application_id']}",
            headers={"Authorization": f"Bearer {state['applicant_token']}"},
        )
        assert r.status_code == 200
        body_text = r.text
        assert '"reasoning"' not in body_text
        assert '"interview_questions"' not in body_text

    def test_applicant_cannot_see_hr_rankings(self, client):
        r = client.get(
            f"/jobs/{state['job_id']}/rankings",
            headers={"Authorization": f"Bearer {state['applicant_token']}"},
        )
        assert r.status_code == 403

    def test_applicant_cannot_close_job(self, client):
        r = client.post(
            f"/jobs/{state['job_id']}/close",
            headers={"Authorization": f"Bearer {state['applicant_token']}"},
            json={},
        )
        assert r.status_code == 403

    def test_applicant_cannot_access_dev_stats(self, client):
        r = client.get(
            "/api/dev/stats",
            headers={"Authorization": f"Bearer {state['applicant_token']}"},
        )
        assert r.status_code == 403

    def test_unauthenticated_hr_jobs_route_rejected(self, client):
        r = client.get("/jobs/hr/jobs")
        assert r.status_code in NO_AUTH

    def test_password_hash_not_in_login_response(self, client):
        r = client.post("/auth/login", json={"email": "hr@openresource.com", "password": "demo1234"})
        assert r.status_code == 200
        assert "password_hash" not in r.text
        assert "password" not in r.json()

    def test_protected_routes_require_bearer_token(self, client):
        routes = [
            ("GET", "/jobs"),
            ("GET", "/jobs/hr/jobs"),
            ("GET", "/api/dev/stats"),
            ("GET", "/api/providers"),
        ]
        for method, path in routes:
            r = client.request(method, path)
            assert r.status_code in NO_AUTH | {422}, \
                f"{method} {path} should require auth, got {r.status_code}"

    def test_hr_cannot_access_another_hr_job(self, client):
        """GET /jobs/{seeded_job_id} where HR is not the owner → 403."""
        # The seeded 'Senior Backend Engineer' job was created by the HR seed user
        # but state["job_id"] is also theirs — use a fake UUID instead
        r = client.get(
            "/jobs/00000000-0000-0000-0000-000000000001",
            headers={"Authorization": f"Bearer {state['hr_token']}"},
        )
        assert r.status_code in (403, 404)


# ─────────────────────────────────────────────────────────────────────────────
# Phase 5 — Edge Cases
# ─────────────────────────────────────────────────────────────────────────────

class TestPhase5_EdgeCases:

    def _create_and_publish_job(self, client, hr_headers) -> str:
        r = client.post("/jobs", headers=hr_headers, json={
            "title": "Edge Case Test Job",
            "description": LONG_JD,
            "location": "Remote",
            "job_type": "remote",
        })
        assert r.status_code == 201
        job_id = r.json()["id"]
        r = client.post(f"/jobs/{job_id}/publish", headers=hr_headers,
                        json={"scoring_weights": VALID_WEIGHTS})
        assert r.status_code == 200
        return job_id

    def test_double_apply_returns_409(self, client, hr_headers):
        """Applying twice to the same active job returns 409."""
        job_id = self._create_and_publish_job(client, hr_headers)
        app_auth = {"Authorization": f"Bearer {state['applicant_token']}"}

        r = client.post(
            f"/jobs/{job_id}/apply",
            headers=app_auth,
            files={"resume": ("cv.pdf", io.BytesIO(MINIMAL_PDF), "application/pdf")},
            data={"cover_note": "First application"},
        )
        assert r.status_code == 201

        r = client.post(
            f"/jobs/{job_id}/apply",
            headers=app_auth,
            files={"resume": ("cv.pdf", io.BytesIO(MINIMAL_PDF), "application/pdf")},
            data={"cover_note": "Second application"},
        )
        assert r.status_code == 409

    def test_non_pdf_upload_returns_415(self, client, hr_headers):
        """Uploading a non-PDF file must return 415."""
        job_id = self._create_and_publish_job(client, hr_headers)
        app_auth = {"Authorization": f"Bearer {state['applicant_token']}"}
        r = client.post(
            f"/jobs/{job_id}/apply",
            headers=app_auth,
            files={"resume": ("resume.txt", io.BytesIO(b"Not a PDF at all"), "text/plain")},
            data={"cover_note": ""},
        )
        assert r.status_code == 415

    def test_apply_to_closed_job_returns_400(self, client):
        """Applying to a closed job must return 400."""
        app_auth = {"Authorization": f"Bearer {state['applicant_token']}"}
        r = client.post(
            f"/jobs/{state['job_id']}/apply",
            headers=app_auth,
            files={"resume": ("cv.pdf", io.BytesIO(MINIMAL_PDF), "application/pdf")},
            data={"cover_note": ""},
        )
        assert r.status_code == 400

    def test_score_active_job_returns_400(self, client, hr_headers):
        """Cannot trigger scoring on an active job."""
        job_id = self._create_and_publish_job(client, hr_headers)
        r = client.post(f"/jobs/{job_id}/score", headers=hr_headers)
        assert r.status_code == 400

    def test_close_already_closed_job_returns_400(self, client, hr_headers):
        """Closing a closed job a second time must return 400."""
        r = client.post(
            f"/jobs/{state['job_id']}/close",
            headers=hr_headers,
            json={},
        )
        assert r.status_code == 400

    def test_cover_note_over_500_chars_rejected(self, client, hr_headers):
        """Cover note exceeding 500 characters must return 400."""
        job_id = self._create_and_publish_job(client, hr_headers)
        app_auth = {"Authorization": f"Bearer {state['applicant_token']}"}
        r = client.post(
            f"/jobs/{job_id}/apply",
            headers=app_auth,
            files={"resume": ("cv.pdf", io.BytesIO(MINIMAL_PDF), "application/pdf")},
            data={"cover_note": "x" * 501},
        )
        assert r.status_code == 400

    def test_publish_weights_not_summing_to_100_rejected(self, client, hr_headers):
        """Weights that don't sum to 100 must be rejected on publish."""
        r = client.post("/jobs", headers=hr_headers, json={
            "title": "Bad Weights Job",
            "description": LONG_JD,
            "location": "Remote",
            "job_type": "remote",
        })
        job_id = r.json()["id"]
        r = client.post(f"/jobs/{job_id}/publish", headers=hr_headers, json={
            "scoring_weights": {
                "technical_skills": 50,
                "experience": 50,
                "projects": 50,
                "education": 50,
                "communication": 50,
            }
        })
        assert r.status_code in (400, 422)

    def test_patch_active_job_blocked(self, client, hr_headers):
        """PATCH /jobs/{id} must fail if job is not in draft state."""
        r = client.patch(
            f"/jobs/{state['job_id']}",
            headers=hr_headers,
            json={"title": "Renamed Active Job"},
        )
        assert r.status_code in (400, 403, 422)

    def test_scoring_config_weights_must_sum_to_100(self, client, dev_headers):
        """PATCH scoring config with weights summing to != 100 returns 422."""
        r = client.patch(
            "/api/dev/scoring-config",
            headers=dev_headers,
            json={"weights": {
                "technical_skills": 50,
                "experience": 50,
                "projects": 50,
                "education": 10,
                "communication": 7,
            }},
        )
        assert r.status_code == 422

    def test_scoring_config_valid_update(self, client, dev_headers):
        r = client.patch(
            "/api/dev/scoring-config",
            headers=dev_headers,
            json={"weights": {
                "technical_skills": 35,
                "experience": 30,
                "projects": 20,
                "education": 10,
                "communication": 5,
            }},
        )
        assert r.status_code == 200
        weights = r.json()["weights"]
        assert sum(weights.values()) == 100

    def test_dev_stats_returns_expected_schema(self, client, dev_headers):
        r = client.get("/api/dev/stats", headers=dev_headers)
        assert r.status_code == 200
        body = r.json()
        required = {
            "total_jobs", "active_jobs", "closed_jobs",
            "total_applications", "total_scored",
            "claude_calls_today", "github_calls_today",
        }
        for field in required:
            assert field in body, f"Missing field in DevStats: {field}"

    def test_dev_logs_filterable_by_provider(self, client, dev_headers):
        r = client.get("/api/dev/logs?api_provider=claude&limit=10", headers=dev_headers)
        assert r.status_code == 200
        body = r.json()
        assert "logs" in body
        assert "total" in body

    def test_dev_logs_status_filter_consistency(self, client, dev_headers):
        r = client.get("/api/dev/logs?status=success&limit=10", headers=dev_headers)
        assert r.status_code == 200
        for log in r.json()["logs"]:
            assert log["status"] == "success"

    def test_api_usage_returns_14_days(self, client, dev_headers):
        r = client.get("/api/dev/api-usage", headers=dev_headers)
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 14
        for entry in data:
            assert "date" in entry
            assert "claude_calls" in entry
            assert "github_calls" in entry

    def test_dev_all_jobs_view(self, client, dev_headers):
        r = client.get("/api/dev/jobs", headers=dev_headers)
        assert r.status_code == 200
        jobs = r.json()
        assert isinstance(jobs, list)
        assert len(jobs) >= 1
        # Must include our integration test job
        ids = [j["id"] for j in jobs]
        assert state["job_id"] in ids

    def test_hr_cannot_see_other_users_applications(self, client, hr_headers):
        """HR can only list applications for their own jobs."""
        r = client.get("/jobs/00000000-0000-0000-0000-000000000999/applications",
                       headers=hr_headers)
        assert r.status_code in (403, 404)
