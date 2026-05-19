from sqlalchemy.orm import Session
from models.models import User, ScoringConfig
from services.auth_service import hash_password, get_user_by_email
from config import settings


def seed_database(db: Session) -> None:
    # Seed HR account
    if not get_user_by_email(db, settings.hr_email):
        db.add(User(
            email=settings.hr_email,
            name="HR Manager",
            password_hash=hash_password(settings.hr_password),
            role="hr",
        ))

    # Seed Dev/Admin account
    if not get_user_by_email(db, settings.dev_email):
        db.add(User(
            email=settings.dev_email,
            name="Admin",
            password_hash=hash_password(settings.dev_password),
            role="dev",
        ))

    # Seed default scoring config
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
