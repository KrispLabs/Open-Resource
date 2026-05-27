import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, DateTime, JSON
from database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ProviderConfig(Base):
    __tablename__ = "provider_configs"

    id = Column(String, primary_key=True, default=_uuid)
    provider_id = Column(String, unique=True, nullable=False, index=True)
    encrypted_config = Column(Text, nullable=True)
    status = Column(String, default="unconfigured")  # unconfigured | configured | healthy | unhealthy
    health = Column(JSON, nullable=True)              # {healthy, last_checked, message}
    created_at = Column(DateTime(timezone=True), default=_now)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now)
