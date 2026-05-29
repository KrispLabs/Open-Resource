"""
Test configuration — sets environment variables BEFORE any app module imports.
All settings are overridden here so tests run against an isolated SQLite DB.
"""
import os
import io
import tempfile

# ── Must run before any app imports ──────────────────────────────────────────
_tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp_db.close()
_tmp_uploads = tempfile.mkdtemp()

os.environ.update(
    DATABASE_URL=f"sqlite:///{_tmp_db.name}",
    JWT_SECRET="test-jwt-secret",
    SERVER_SECRET_KEY="test-server-secret-32chars!!!!!!",
    UPLOAD_DIR=_tmp_uploads,
    HR_EMAIL="hr@openresource.com",
    HR_PASSWORD="demo1234",
    DEV_EMAIL="admin@openresource.com",
    DEV_PASSWORD="demo1234",
    # Fake key so migrate_env_to_db configures featherless on startup
    FEATHERLESSAI_API_KEY="test-featherless-key-integration",
    GITHUB_TOKEN="",
    BRIGHTDATA_API_KEY="",
    FRONTEND_ORIGINS="http://localhost:5173",
)

# ── Now safe to import app ────────────────────────────────────────────────────
import json
import pytest
import respx
import httpx
import fitz  # PyMuPDF — create real PDF with text for tests
from fastapi.testclient import TestClient
from main import app


# ── Shared test state (populated by tests in order) ──────────────────────────
state: dict = {}


# ── Minimal PDF with extractable text ────────────────────────────────────────
def _make_pdf_with_text() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text(
        (50, 72),
        (
            "Jane Smith — Senior Python Engineer\n"
            "5 years of FastAPI, PostgreSQL, Docker, and AWS experience.\n"
            "Built distributed microservices at scale. Strong system design skills.\n"
            "Open source contributor. B.Sc. Computer Science."
        ),
        fontsize=11,
    )
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


MINIMAL_PDF = _make_pdf_with_text()


# ── 50-word job descriptions for all test jobs ────────────────────────────────
LONG_JD = (
    "We are looking for a senior backend engineer with five or more years of Python "
    "experience. The ideal candidate has strong knowledge of FastAPI, PostgreSQL, and "
    "distributed systems. Experience with Docker, Kubernetes, and AWS is required. "
    "The role involves designing scalable APIs, leading technical architecture "
    "discussions, and mentoring junior engineers. Strong understanding of system "
    "design, microservices, CI/CD pipelines, and observability tooling is essential. "
    "We value pragmatic engineers who ship high-quality software and communicate well."
)


# ── Featherless AI mock responses ─────────────────────────────────────────────

JD_ANALYSIS_RESPONSE = {
    "choices": [{
        "message": {
            "content": json.dumps({
                "role_title": "Senior Backend Engineer",
                "seniority": "senior",
                "must_have_skills": ["Python", "FastAPI", "PostgreSQL"],
                "nice_to_have_skills": ["Docker", "Kubernetes"],
                "experience_years_min": 5,
                "proposed_weights": {
                    "technical_skills": 40,
                    "experience": 25,
                    "projects": 20,
                    "education": 8,
                    "communication": 7,
                },
                "weight_reasoning": "Technical skills prioritised for backend engineering role.",
            })
        }
    }],
    "usage": {"total_tokens": 250},
}

SCORE_RESPONSE = {
    "choices": [{
        "message": {
            "content": json.dumps({
                "technical_score": 85.0,
                "experience_score": 80.0,
                "project_score": 82.0,
                "education_score": 75.0,
                "communication_score": 78.0,
                "verdict": "shortlisted",
                "reasoning": "Strong candidate with solid Python and FastAPI experience.",
                "strengths": ["Python expertise", "FastAPI", "PostgreSQL"],
                "gaps": ["Limited Kubernetes exposure"],
                "matched_skills": ["Python", "FastAPI", "PostgreSQL"],
                "missing_skills": ["Kubernetes"],
                "interview_questions": [
                    "Describe your distributed systems experience.",
                    "How do you approach API versioning?",
                    "Walk through a complex system design.",
                ],
                "applicant_feedback": (
                    "Your technical background aligns well with our requirements. "
                    "Strong Python and FastAPI expertise noted."
                ),
            })
        }
    }],
    "usage": {"total_tokens": 400},
}

PROVIDER_VALIDATE_RESPONSE = {
    "choices": [{"message": {"content": "pong"}}],
    "usage": {"total_tokens": 5},
}


def _featherless_dispatch(request: httpx.Request) -> httpx.Response:
    """Return JD or scoring response based on the prompt content."""
    try:
        body = json.loads(request.content)
        messages = body.get("messages", [])
        # Combine all message content for inspection
        combined = " ".join(
            str(m.get("content", "")) for m in messages
        )
        if "ping" in combined and len(combined) < 50:
            return httpx.Response(200, json=PROVIDER_VALIDATE_RESPONSE)
        if "Score this candidate" in combined:
            return httpx.Response(200, json=SCORE_RESPONSE)
        if "proposed_weights" in combined or "seniority" in combined:
            return httpx.Response(200, json=JD_ANALYSIS_RESPONSE)
        return httpx.Response(200, json=PROVIDER_VALIDATE_RESPONSE)
    except Exception:
        return httpx.Response(200, json=PROVIDER_VALIDATE_RESPONSE)


@pytest.fixture(scope="session")
def featherless_mock():
    """Session-scoped respx mock that intercepts all Featherless AI calls."""
    with respx.mock(base_url="https://api.featherless.ai", assert_all_called=False) as mock:
        mock.post("/v1/chat/completions").mock(side_effect=_featherless_dispatch)
        yield mock


@pytest.fixture(scope="session")
def github_api_mock():
    """Mock GitHub API calls (used during provider validation)."""
    with respx.mock(base_url="https://api.github.com", assert_all_called=False) as mock:
        mock.get("/user").mock(return_value=httpx.Response(
            200, json={"login": "testuser", "id": 12345}
        ))
        yield mock


@pytest.fixture(scope="session")
def client(featherless_mock, github_api_mock):
    """Session-scoped TestClient — lifespan runs once for entire test session."""
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c


@pytest.fixture(scope="session")
def hr_headers(client):
    r = client.post("/auth/login", json={"email": "hr@openresource.com", "password": "demo1234"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def dev_headers(client):
    r = client.post("/auth/login", json={"email": "admin@openresource.com", "password": "demo1234"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}
