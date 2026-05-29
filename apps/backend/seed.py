import json
from sqlalchemy.orm import Session
from models.models import User, ScoringConfig, Job, Application, CandidateScore
from services.auth_service import hash_password, get_user_by_email
from config import settings


def seed_database(db: Session) -> None:
    # ── Seed HR account ───────────────────────────────────────────────────────
    if not get_user_by_email(db, settings.hr_email):
        db.add(User(
            email=settings.hr_email,
            name="HR Manager",
            password_hash=hash_password(settings.hr_password),
            role="hr",
        ))

    # ── Seed Dev/Admin account ────────────────────────────────────────────────
    if not get_user_by_email(db, settings.dev_email):
        db.add(User(
            email=settings.dev_email,
            name="Admin",
            password_hash=hash_password(settings.dev_password),
            role="dev",
        ))

    # ── Seed Demo Applicant accounts ─────────────────────────────────────────
    if not get_user_by_email(db, "demo@applicant.com"):
        db.add(User(
            email="demo@applicant.com",
            name="Demo Applicant",
            password_hash=hash_password("demo1234"),
            role="applicant",
        ))
    if not get_user_by_email(db, "alice@applicant.com"):
        db.add(User(
            email="alice@applicant.com",
            name="Alice Chen",
            password_hash=hash_password("demo1234"),
            role="applicant",
        ))
    if not get_user_by_email(db, "bob@applicant.com"):
        db.add(User(
            email="bob@applicant.com",
            name="Bob Kumar",
            password_hash=hash_password("demo1234"),
            role="applicant",
        ))

    # ── Seed default scoring config ───────────────────────────────────────────
    existing_config = db.query(ScoringConfig).filter(ScoringConfig.is_default == True).first()
    if not existing_config:
        db.add(ScoringConfig(
            label="Global Default",
            weights={
                "technical_skills": 40,
                "experience": 25,
                "projects": 20,
                "education": 8,
                "communication": 7,
            },
            is_default=True,
        ))

    db.commit()

    # ── Seed demo jobs (created by HR user) ───────────────────────────────────
    hr_user = get_user_by_email(db, settings.hr_email)

    existing_job1 = db.query(Job).filter(Job.title == "Senior Backend Engineer").first()
    job1 = existing_job1
    if not existing_job1:
        job1 = Job(
            created_by=hr_user.id,
            title="Senior Backend Engineer",
            description=(
                "We are looking for a Senior Backend Engineer with 5+ years of Python experience, "
                "strong knowledge of FastAPI, PostgreSQL, and distributed systems. Experience with "
                "Docker, Kubernetes, and AWS is required. The role involves designing scalable APIs, "
                "leading technical architecture discussions, and mentoring junior engineers. Strong "
                "understanding of system design, microservices, and CI/CD pipelines is essential."
            ),
            location="Remote",
            job_type="remote",
            status="active",
            scoring_weights={
                "technical_skills": 35,
                "experience": 25,
                "projects": 20,
                "education": 10,
                "communication": 10,
            },
            jd_parsed={
                "proposed_weights": {
                    "technical_skills": 35,
                    "experience": 25,
                    "projects": 20,
                    "education": 10,
                    "communication": 10,
                },
                "weight_reasoning": "Technical skills weighted highest for backend role",
            },
        )
        db.add(job1)
        db.flush()

    if not db.query(Job).filter(Job.title == "Full Stack Developer").first():
        db.add(Job(
            created_by=hr_user.id,
            title="Full Stack Developer",
            description=(
                "Seeking a Full Stack Developer proficient in React, TypeScript, and Node.js with "
                "3+ years experience. Must have experience with REST APIs, SQL databases, and modern "
                "frontend tooling. Responsibilities include building user-facing features, maintaining "
                "backend services, writing tests, and collaborating with design team. Experience with "
                "AWS or GCP is a plus."
            ),
            location="New York, NY",
            job_type="hybrid",
            status="active",
            scoring_weights={
                "technical_skills": 30,
                "experience": 25,
                "projects": 25,
                "education": 10,
                "communication": 10,
            },
            jd_parsed={
                "proposed_weights": {
                    "technical_skills": 30,
                    "experience": 25,
                    "projects": 25,
                    "education": 10,
                    "communication": 10,
                },
                "weight_reasoning": "Balanced weights for full stack role",
            },
        ))

    db.commit()

    # ── Seed pre-scored applications for Job 1 ────────────────────────────────
    # Reload job1 after commit in case it was just created
    job1 = db.query(Job).filter(Job.title == "Senior Backend Engineer").first()
    demo_applicant = get_user_by_email(db, "demo@applicant.com")
    alice = get_user_by_email(db, "alice@applicant.com")
    bob = get_user_by_email(db, "bob@applicant.com")

    app_data = [
        {
            "applicant_id": demo_applicant.id,
            "resume_filename": "demo_resume_1.pdf",
            "status": "shortlisted",
            "rank": 1,
            "scores": {
                "technical_score": 88,
                "experience_score": 82,
                "project_score": 85,
                "education_score": 78,
                "communication_score": 90,
                "weighted_total": 85,
                "verdict": "shortlisted",
                "reasoning": "Strong candidate with excellent Python and FastAPI expertise.",
                "strengths": json.dumps(["Strong Python expertise", "FastAPI experience", "Good communication skills"]),
                "gaps": json.dumps(["Limited Kubernetes experience"]),
                "matched_skills": json.dumps(["Python", "FastAPI", "PostgreSQL"]),
                "missing_skills": json.dumps(["Kubernetes"]),
                "interview_questions": json.dumps(["Describe your experience with distributed systems", "How do you approach API versioning?"]),
                "applicant_feedback": "Strong technical background with excellent communication skills. Your FastAPI and Python expertise align well with our requirements.",
            },
        },
        {
            "applicant_id": alice.id,
            "resume_filename": "demo_resume_2.pdf",
            "status": "reviewing",
            "rank": 2,
            "scores": {
                "technical_score": 75,
                "experience_score": 70,
                "project_score": 72,
                "education_score": 80,
                "communication_score": 68,
                "weighted_total": 73,
                "verdict": "reviewing",
                "reasoning": "Solid candidate with room to grow in distributed systems.",
                "strengths": json.dumps(["Solid Python skills", "Good education background"]),
                "gaps": json.dumps(["Limited distributed systems experience", "Needs more project examples"]),
                "matched_skills": json.dumps(["Python", "FastAPI"]),
                "missing_skills": json.dumps(["Kubernetes", "AWS", "Distributed systems"]),
                "interview_questions": json.dumps(["Walk me through a complex system you designed", "How do you handle database migrations?"]),
                "applicant_feedback": "Good foundational skills with room for growth in distributed systems.",
            },
        },
        {
            "applicant_id": bob.id,
            "resume_filename": "demo_resume_3.pdf",
            "status": "rejected",
            "rank": 3,
            "scores": {
                "technical_score": 60,
                "experience_score": 55,
                "project_score": 58,
                "education_score": 65,
                "communication_score": 62,
                "weighted_total": 59,
                "verdict": "rejected",
                "reasoning": "Does not meet senior-level experience requirements.",
                "strengths": json.dumps(["Basic Python knowledge"]),
                "gaps": json.dumps(["Insufficient senior-level experience", "Limited cloud experience", "Missing required skills"]),
                "matched_skills": json.dumps(["Python"]),
                "missing_skills": json.dumps(["FastAPI", "PostgreSQL", "Docker", "Kubernetes", "AWS"]),
                "interview_questions": json.dumps(["What steps are you taking to improve your skills?"]),
                "applicant_feedback": "Your application showed enthusiasm but doesn't meet the experience requirements for this senior role.",
            },
        },
    ]

    for entry in app_data:
        existing_app = db.query(Application).filter(
            Application.job_id == job1.id,
            Application.applicant_id == entry["applicant_id"],
        ).first()
        if existing_app:
            continue

        app = Application(
            job_id=job1.id,
            applicant_id=entry["applicant_id"],
            resume_filename=entry["resume_filename"],
            status=entry["status"],
            rank=entry["rank"],
        )
        db.add(app)
        db.flush()

        s = entry["scores"]
        score = CandidateScore(
            application_id=app.id,
            technical_score=s["technical_score"],
            experience_score=s["experience_score"],
            project_score=s["project_score"],
            education_score=s["education_score"],
            communication_score=s["communication_score"],
            weighted_total=s["weighted_total"],
            verdict=s["verdict"],
            reasoning=s["reasoning"],
            strengths=json.loads(s["strengths"]),
            gaps=json.loads(s["gaps"]),
            matched_skills=json.loads(s["matched_skills"]),
            missing_skills=json.loads(s["missing_skills"]),
            interview_questions=json.loads(s["interview_questions"]),
            applicant_feedback=s["applicant_feedback"],
        )
        db.add(score)

    db.commit()
