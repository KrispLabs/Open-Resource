from sqlalchemy.orm import Session
from models.models import SystemLog


def write_log(
    db: Session,
    *,
    event_type: str,
    api_provider: str,
    latency_ms: int,
    status: str,
    job_id: str | None = None,
    application_id: str | None = None,
    campaign_id: str | None = None,
    triggered_by: str | None = None,
    tokens_used: int | None = None,
    error_message: str | None = None,
) -> SystemLog:
    log = SystemLog(
        event_type=event_type,
        api_provider=api_provider,
        latency_ms=latency_ms,
        status=status,
        job_id=job_id,
        application_id=application_id,
        campaign_id=campaign_id,
        triggered_by=triggered_by,
        tokens_used=tokens_used,
        error_message=error_message,
    )
    db.add(log)
    db.commit()
    return log
